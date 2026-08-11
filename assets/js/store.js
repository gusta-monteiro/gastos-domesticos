/* store.js — camada de sincronização com o Supabase (Fase 1)
 *
 * Estratégia: o localStorage continua sendo o "cache" que o app lê e grava de
 * forma síncrona (nada no app.js muda além de esperar a hidratação inicial).
 * Este módulo:
 *   1. exige sessão (protege a página — sem login, volta para auth.html);
 *   2. na abertura, baixa os dados do usuário da nuvem para o localStorage;
 *   3. na primeira vez, se a nuvem estiver vazia e houver dados locais, sobe tudo;
 *   4. intercepta cada gravação em chaves "fin_*" e replica para a nuvem (debounced).
 *
 * Só mexe nas chaves "fin_YYYY-MM" (meses) e "fin_inv_classes" (classes de
 * investimento). A chave da sessão do próprio Supabase não é tocada.
 */
(function () {
  const MONTH_RE = /^fin_(\d{4})-(\d{2})$/;
  const INV_KEY = "fin_inv_classes";
  // Reserva de Emergência é liquidez, não uma classe de risco: não entra no
  // rateio por % das outras classes, recebe 100% do que for lançado em
  // "emergencia". Mesma tabela (invest_classes), key reservada para diferenciar.
  const RESERVA_KEY = "reserva_emergencia";
  const nativeSetItem = localStorage.setItem.bind(localStorage);

  let userId = null;
  const pending = new Set();
  let flushTimer = null;

  function monthFromKey(k) {
    const m = k.match(MONTH_RE);
    return m ? { year: +m[1], month: +m[2] } : null; // month 1-12
  }

  async function requireSession() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
      window.location.replace("auth.html");
      return null;
    }
    return session.user;
  }

  /* ── Nuvem → localStorage ── */
  async function pull() {
    const [{ data: months, error: e1 }, { data: classes, error: e2 }] = await Promise.all([
      db.from("budget_months").select("year, month, renda, payload").eq("user_id", userId),
      db.from("invest_classes").select("id, key, label, target_pct, color, position, archived, expected_return_aa")
        .eq("user_id", userId).order("position"),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;

    (months || []).forEach((row) => {
      const key = `fin_${row.year}-${String(row.month).padStart(2, "0")}`;
      const value = {
        renda: row.renda ? String(row.renda) : "",
        cats: (row.payload && row.payload.cats) || [],
      };
      // rendas detalhadas só existem em meses gravados pela versão nova;
      // sem elas, o loadMonth do app deriva uma entrada única do total.
      if (row.payload && Array.isArray(row.payload.rendas)) value.rendas = row.payload.rendas;
      nativeSetItem(key, JSON.stringify(value));
    });

    // Se o usuário já tem QUALQUER classe na nuvem (ativa ou arquivada), a nuvem
    // manda: gravamos só as ativas — inclusive lista vazia, que significa "apagou
    // todas". Sem nenhuma linha, é conta nova: preserva o local (classes padrão).
    if (classes && classes.length) {
      const ativas = classes.filter((c) => !c.archived).map((c) => ({
        key: c.key, label: c.label, pct: Number(c.target_pct), color: c.color,
        aa: Number(c.expected_return_aa) || 0,
      }));
      nativeSetItem(INV_KEY, JSON.stringify(ativas));
    }
    return { monthCount: (months || []).length, classCount: (classes || []).length };
  }

  /* ── localStorage → nuvem ── */
  async function pushMonthKey(key) {
    const raw = localStorage.getItem(key);
    const info = monthFromKey(key);
    if (!raw || !info) return;
    let obj;
    try { obj = JSON.parse(raw); } catch { return; }
    // Meses de antes desta versão só tinham "renda" (um número), sem "rendas"
    // (a lista). "rendas" ausente (Array.isArray === false) é migrado para uma
    // entrada única; "rendas" já presente — mesmo vazio, [] — é respeitado como
    // está, porque nesse caso [] é uma escolha real do usuário (apagou tudo).
    const rendas = Array.isArray(obj.rendas) ? obj.rendas
      : (parseFloat(obj.renda) > 0 ? [{ name: "Renda", value: String(obj.renda) }] : []);
    const { error } = await db.from("budget_months").upsert({
      user_id: userId,
      year: info.year,
      month: info.month,
      renda: parseFloat(obj.renda) || 0,
      payload: { cats: obj.cats || [], rendas },
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,year,month" });
    if (error) throw error;

    await pushInvestLedger(info.year, info.month, obj.cats || []);
  }

  async function buscarClassesAtivas() {
    const { data, error } = await db.from("invest_classes")
      .select("id, key, target_pct").eq("user_id", userId).eq("archived", false);
    if (error) throw error;
    return data || [];
  }

  /* Todo mês, o aporte de Independência é rateado entre as classes de
     investimento (pela % de hoje) e o de Emergência vai 100% para a
     reserva — grava uma linha por classe em invest_ledger. Isso roda a
     cada vez que o mês é salvo, então uma edição num mês antigo recalcula
     só aquele mês, nunca o histórico inteiro (histórico já gravado fica
     como estava até ser tocado de novo).
     `classesPreCarregadas` evita buscar de novo quando o chamador (o
     backfill abaixo) já processou várias linhas na mesma passada. */
  async function pushInvestLedger(year, month, cats, classesPreCarregadas) {
    const totalDe = (key) => {
      const cat = cats.find((c) => c.key === key);
      return cat ? cat.items.reduce((s, it) => s + (parseFloat(it.value) || 0), 0) : 0;
    };
    const totalIndep = totalDe("independencia");
    const totalEmerg = totalDe("emergencia");
    if (totalIndep <= 0 && totalEmerg <= 0) return;

    const classes = classesPreCarregadas || await buscarClassesAtivas();
    if (!classes.length) return;

    const investimento = classes.filter((c) => c.key !== RESERVA_KEY);
    const reserva = classes.find((c) => c.key === RESERVA_KEY);
    // Rateia pela SOMA real das % ativas, não por 100 fixo — assim a soma
    // gravada bate com o valor lançado mesmo quando as % não somam 100%
    // (o aviso na tela é só um alerta, nunca bloqueou o usuário de salvar).
    const somaPct = investimento.reduce((s, c) => s + (parseFloat(c.target_pct) || 0), 0);
    const agora = new Date().toISOString();

    const linhas = [];
    if (somaPct > 0) {
      investimento.forEach((c) => {
        linhas.push({
          user_id: userId, class_id: c.id, year, month,
          aporte: totalIndep * (parseFloat(c.target_pct) || 0) / somaPct,
          updated_at: agora,
        });
      });
    }
    if (reserva) {
      linhas.push({ user_id: userId, class_id: reserva.id, year, month, aporte: totalEmerg, updated_at: agora });
    }
    if (!linhas.length) return;

    const { error: ledgerErr } = await db.from("invest_ledger")
      .upsert(linhas, { onConflict: "user_id,class_id,year,month" });
    if (ledgerErr) throw ledgerErr;
  }

  /* Marcação a mercado manual: grava o saldo real de uma classe no mês que
     a calculadora está mostrando, sem mexer no aporte já calculado (lê
     antes de decidir entre update/insert — um upsert direto com aporte:0
     apagaria um aporte que já existia). */
  async function salvarSaldoReal(classKey, saldo) {
    if (!userId) throw new Error("sem sessão ativa");
    const year = curYear;
    const month = curMonth + 1;
    const { data: cls, error: e1 } = await db.from("invest_classes")
      .select("id").eq("user_id", userId).eq("key", classKey).maybeSingle();
    if (e1) throw e1;
    if (!cls) throw new Error("classe ainda não sincronizada — tente de novo em alguns segundos");

    const { data: existente, error: e2 } = await db.from("invest_ledger")
      .select("id").eq("user_id", userId).eq("class_id", cls.id)
      .eq("year", year).eq("month", month).maybeSingle();
    if (e2) throw e2;

    const agora = new Date().toISOString();
    if (existente) {
      const { error } = await db.from("invest_ledger")
        .update({ saldo_real: saldo, updated_at: agora }).eq("id", existente.id);
      if (error) throw error;
    } else {
      const { error } = await db.from("invest_ledger").insert({
        user_id: userId, class_id: cls.id, year, month, aporte: 0, saldo_real: saldo, updated_at: agora,
      });
      if (error) throw error;
    }
  }

  async function pushInvClasses() {
    const raw = localStorage.getItem(INV_KEY);
    if (!raw) return;
    let arr;
    try { arr = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(arr)) return;

    // dedup por key (último vence) — um lote com key repetida aborta o upsert inteiro
    const porKey = new Map(arr.map((c) => [c.key, c]));
    const lista = [...porKey.values()];

    if (lista.length) {
      const rows = lista.map((c, i) => ({
        user_id: userId,
        key: c.key,
        label: c.label,
        target_pct: parseFloat(c.pct) || 0,
        expected_return_aa: parseFloat(c.aa) || 0,
        color: c.color || "#888780",
        position: i,
        archived: false,
      }));
      const { error } = await db.from("invest_classes").upsert(rows, { onConflict: "user_id,key" });
      if (error) throw error;
    }

    // Arquiva na nuvem as classes que o usuário apagou no app. Soft-delete de
    // propósito: um DELETE físico cascatearia sobre invest_ledger e destruiria
    // o histórico de aportes. O upsert acima vem ANTES para que uma classe
    // recriada com a mesma key seja revivida, não re-arquivada.
    let q = db.from("invest_classes")
      .update({ archived: true })
      .eq("user_id", userId)
      .eq("archived", false);
    if (lista.length) {
      q = q.not("key", "in", `(${lista.map((c) => JSON.stringify(String(c.key))).join(",")})`);
    }
    const { error: archErr } = await q;
    if (archErr) throw archErr;
  }

  /* ── Fila de escrita (debounced) ── */
  async function flush() {
    flushTimer = null;
    const keys = [...pending];
    pending.clear();
    for (const key of keys) {
      try {
        if (key === INV_KEY) await pushInvClasses();
        else await pushMonthKey(key);
      } catch (err) {
        console.error("[store] falha ao sincronizar", key, err);
        pending.add(key); // tenta de novo na próxima
      }
    }
  }
  function queue(key) {
    pending.add(key);
    if (!flushTimer) flushTimer = setTimeout(flush, 800);
  }

  // Intercepta as gravações do app e replica as chaves "fin_*" para a nuvem.
  localStorage.setItem = function (key, value) {
    nativeSetItem(key, value);
    if (userId && (key === INV_KEY || MONTH_RE.test(key))) queue(key);
  };

  /* ── Migração única: nuvem vazia + dados locais → sobe tudo ── */
  async function migrateIfNeeded(pulled) {
    if (pulled.monthCount > 0 || pulled.classCount > 0) return 0;
    const localKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === INV_KEY || MONTH_RE.test(k)) localKeys.push(k);
    }
    for (const k of localKeys) {
      if (k === INV_KEY) await pushInvClasses();
      else await pushMonthKey(k);
    }
    return localKeys.length;
  }

  /* Usuários que já tinham classes salvas antes da separação da Reserva de
     Emergência não têm essa entrada — adiciona uma vez. Contas novas já
     nascem com ela via o fallback de loadInvClasses() no app.js; aqui é só
     a rede de segurança para quem já tinha classes gravadas sem ela. */
  function ensureReservaClasse() {
    const raw = localStorage.getItem(INV_KEY);
    if (!raw) return;
    let arr;
    try { arr = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(arr) || arr.some((c) => c.key === RESERVA_KEY)) return;
    arr.push({ key: RESERVA_KEY, label: "Reserva de Emergência", pct: 0, color: "#2f6f62", aa: 0.1025 });
    nativeSetItem(INV_KEY, JSON.stringify(arr));
    queue(INV_KEY);
  }

  async function init() {
    const user = await requireSession();
    if (!user) return;
    userId = user.id;
    let pulled = { monthCount: 0, classCount: 0 };
    try {
      pulled = await pull();
    } catch (err) {
      console.error("[store] erro ao baixar dados da nuvem", err);
    }
    try {
      const migrated = await migrateIfNeeded(pulled);
      if (migrated) console.log(`[store] ${migrated} registro(s) local(is) enviado(s) para a nuvem`);
    } catch (err) {
      console.error("[store] erro na migração inicial", err);
    }
    try {
      ensureReservaClasse();
    } catch (err) {
      console.error("[store] erro ao garantir a classe de reserva", err);
    }
  }

  /* Chamado sempre que a aba de Investimentos é aberta.
     Duas coisas, nessa ordem:
     1. Garante que as classes existem na nuvem (senão o mês novo não teria
        onde escrever o aporte) e ressincroniza o ledger do mês REAL de
        hoje — new Date(), nunca curMonth/curYear, que é o mês que a
        Calculadora está exibindo e pode ser qualquer mês passado.
     2. Preenche a LACUNA de qualquer mês local com independencia/emergencia
        lançado que ainda não tem nenhuma linha em invest_ledger (cobre o
        usuário que lançou vários meses antes de nunca ter aberto esta aba).
     Nunca reescreve um mês que JÁ tem linha no ledger — só o mês de hoje é
     sempre atualizado; os demais são "preenche uma vez e não toca mais",
     que é o que preserva o histórico já gravado das % de quando foi salvo. */
  async function garantirLedgerCompleto() {
    await pushInvClasses();
    const classes = await buscarClassesAtivas();
    if (!classes.length) return;

    const { data: cobertura, error } = await db.from("invest_ledger")
      .select("year, month").eq("user_id", userId);
    if (error) throw error;
    const jaTemLedger = new Set((cobertura || []).map((r) => r.year + "-" + r.month));

    const hoje = new Date();
    const anoAtual = hoje.getFullYear(), mesAtual = hoje.getMonth() + 1;

    for (let i = 0; i < localStorage.length; i++) {
      const info = monthFromKey(localStorage.key(i));
      if (!info) continue;
      const ehMesAtual = info.year === anoAtual && info.month === mesAtual;
      if (!ehMesAtual && jaTemLedger.has(info.year + "-" + info.month)) continue;

      const raw = localStorage.getItem(localStorage.key(i));
      let md;
      try { md = JSON.parse(raw); } catch { continue; }
      await pushInvestLedger(info.year, info.month, md.cats || [], classes);
    }
  }

  window.store = { ready: init(), salvarSaldoReal, garantirLedgerCompleto };
})();
