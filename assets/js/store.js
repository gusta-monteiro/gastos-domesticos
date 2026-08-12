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
  const INV_KEY_META = "fin_inv_classes_meta";
  const PERFIL_KEY = "fin_perfil";
  // Reserva de Emergência é liquidez, não uma classe de risco: não entra no
  // rateio por % das outras classes, recebe 100% do que for lançado em
  // "emergencia". Mesma tabela (invest_classes), key reservada para diferenciar.
  const RESERVA_KEY = "reserva_emergencia";
  const nativeSetItem = localStorage.setItem.bind(localStorage);

  let userId = null;
  const pending = new Set();
  let flushTimer = null;
  let flushing = false;

  /* A fila pendente sobrevive a fechar a aba: sem isso, uma edição que não
     subiu (rede caiu, celular matou a aba, sessão venceu) ficava órfã — e o
     pull do próximo login sobrescrevia o localStorage com a versão antiga
     da nuvem, apagando a edição até do aparelho. Com a fila persistida, o
     init() empurra as pendências ANTES de puxar, e o pull pula essas chaves. */
  const PENDING_KEY = "fin_pending_sync";
  function persistPending() {
    nativeSetItem(PENDING_KEY, JSON.stringify([...pending]));
  }
  function restorePending() {
    try {
      const arr = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
      if (Array.isArray(arr)) arr.forEach((k) => { if (typeof k === "string") pending.add(k); });
    } catch { /* fila corrompida: ignora */ }
  }

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
    // O perfil é tratado à parte (best-effort, nunca com throw): é a tabela
    // mais nova, e uma migração ainda não aplicada (janela entre o deploy do
    // front e o back terminar) não pode derrubar a sincronização de meses e
    // classes, que são o que realmente importa pro app funcionar.
    const perfilPromise = db.from("user_profile")
      .select("respostas, perfil_key, cats_pct, risco, updated_at").eq("user_id", userId).maybeSingle()
      .then((r) => r, (err) => ({ data: null, error: err }));
    const [{ data: months, error: e1 }, { data: classes, error: e2 }, { data: perfil, error: e3 }] = await Promise.all([
      db.from("budget_months").select("year, month, renda, payload").eq("user_id", userId),
      db.from("invest_classes").select("id, key, label, target_pct, color, position, archived, expected_return_aa, portfolio")
        .eq("user_id", userId).order("position"),
      perfilPromise,
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    if (e3) console.error("[store] erro ao baixar perfil (tabela pode ainda não existir)", e3);

    (months || []).forEach((row) => {
      const key = `fin_${row.year}-${String(row.month).padStart(2, "0")}`;
      // Chave com edição local ainda não enviada: o local é mais novo que a
      // nuvem — sobrescrever aqui apagaria a edição pendente do usuário.
      if (pending.has(key)) return;
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
    // Cada carteira (independência/meta) tem sua própria condição — uma conta
    // pode já ter classes de Independência mas nunca ter mexido na Meta ainda.
    if (classes && classes.length) {
      const toRow = (c) => ({
        key: c.key, label: c.label, pct: Number(c.target_pct), color: c.color,
        aa: Number(c.expected_return_aa) || 0,
      });
      const porPortfolio = (p) => classes.filter((c) => (c.portfolio || "independencia") === p);
      const indep = porPortfolio("independencia");
      const meta = porPortfolio("meta");
      if (indep.length && !pending.has(INV_KEY)) nativeSetItem(INV_KEY, JSON.stringify(indep.filter((c) => !c.archived).map(toRow)));
      if (meta.length && !pending.has(INV_KEY_META)) nativeSetItem(INV_KEY_META, JSON.stringify(meta.filter((c) => !c.archived).map(toRow)));
    }

    if (perfil && !pending.has(PERFIL_KEY)) {
      nativeSetItem(PERFIL_KEY, JSON.stringify({
        respostas: perfil.respostas || {}, perfilKey: perfil.perfil_key,
        cats_pct: perfil.cats_pct || {}, risco: perfil.risco,
        atualizadoEm: perfil.updated_at || null,
      }));
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

  async function buscarClassesAtivas(portfolio) {
    let q = db.from("invest_classes")
      .select("id, key, target_pct, portfolio").eq("user_id", userId).eq("archived", false);
    if (portfolio) q = q.eq("portfolio", portfolio);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  /* Todo mês, o aporte de Independência é rateado entre as classes da
     carteira de Independência (pela % de hoje), o de Meta entre as classes
     da carteira de Meta, e o de Emergência vai 100% para a reserva — grava
     uma linha por classe em invest_ledger. Isso roda a cada vez que o mês é
     salvo, então uma edição num mês antigo recalcula só aquele mês, nunca o
     histórico inteiro (histórico já gravado fica como estava até ser
     tocado de novo).
     `classesPreCarregadas`, se vier, é { independencia: [...], meta: [...] }
     — evita buscar de novo quando o chamador (o backfill abaixo) já
     processou várias linhas na mesma passada. */
  async function pushInvestLedger(year, month, cats, classesPreCarregadas) {
    const totalDe = (key) => {
      const cat = cats.find((c) => c.key === key);
      return cat ? cat.items.reduce((s, it) => s + (parseFloat(it.value) || 0), 0) : 0;
    };
    const totalIndep = totalDe("independencia");
    const totalMeta = totalDe("meta");
    const totalEmerg = totalDe("emergencia");
    if (totalIndep <= 0 && totalMeta <= 0 && totalEmerg <= 0) {
      // Nada lançado neste mês. Mês que nunca teve aporte não escreve linha
      // zerada à toa (o WHERE aporte!=0 abaixo já garante isso sozinho, sem
      // precisar de uma leitura antes — um SELECT-depois-UPDATE separado
      // deixaria uma janela pra uma edição concorrente no mesmo mês (apagar
      // e relançar rápido) intercalar e o zeramento vencer por cima de um
      // valor novo de verdade). Mas se JÁ existe aporte (o usuário apagou um
      // lançamento que antes tinha valor), precisa zerar agora — senão o
      // ledger fica "preso" com o valor antigo pra sempre, e ele continua
      // entrando no patrimônio mesmo sem aparecer em lugar nenhum na
      // Calculadora. Não precisa saber de qual carteira era: zera qualquer
      // linha desse mês, seja ela de Independência, Meta ou Reserva.
      const { error: eUpd } = await db.from("invest_ledger")
        .update({ aporte: 0, updated_at: new Date().toISOString() })
        .eq("user_id", userId).eq("year", year).eq("month", month)
        .neq("aporte", 0);
      if (eUpd) throw eUpd;
      return;
    }

    const classesIndep = (classesPreCarregadas && classesPreCarregadas.independencia)
      || await buscarClassesAtivas("independencia");
    const classesMeta = (classesPreCarregadas && classesPreCarregadas.meta)
      || await buscarClassesAtivas("meta");

    const investimento = classesIndep.filter((c) => c.key !== RESERVA_KEY);
    const reserva = classesIndep.find((c) => c.key === RESERVA_KEY);
    const agora = new Date().toISOString();
    const linhas = [];

    // Rateia pela SOMA real das % ativas, não por 100 fixo — assim a soma
    // gravada bate com o valor lançado mesmo quando as % não somam 100%
    // (o aviso na tela é só um alerta, nunca bloqueou o usuário de salvar).
    const somaPctIndep = investimento.reduce((s, c) => s + (parseFloat(c.target_pct) || 0), 0);
    if (somaPctIndep > 0) {
      investimento.forEach((c) => {
        linhas.push({
          user_id: userId, class_id: c.id, year, month,
          aporte: totalIndep * (parseFloat(c.target_pct) || 0) / somaPctIndep,
          updated_at: agora,
        });
      });
    }
    if (reserva) {
      linhas.push({ user_id: userId, class_id: reserva.id, year, month, aporte: totalEmerg, updated_at: agora });
    }

    const somaPctMeta = classesMeta.reduce((s, c) => s + (parseFloat(c.target_pct) || 0), 0);
    if (somaPctMeta > 0) {
      classesMeta.forEach((c) => {
        linhas.push({
          user_id: userId, class_id: c.id, year, month,
          aporte: totalMeta * (parseFloat(c.target_pct) || 0) / somaPctMeta,
          updated_at: agora,
        });
      });
    }
    if (!linhas.length) return;

    const { error: ledgerErr } = await db.from("invest_ledger")
      .upsert(linhas, { onConflict: "user_id,class_id,year,month" });
    if (ledgerErr) throw ledgerErr;

    // Zera sobra de classe que recebia este mês antes e não recebe mais —
    // sem isso, reconfigurar as classes (apagar as antigas, criar novas)
    // faz o MESMO valor lançado ficar contado duas vezes: uma vez "preso"
    // na classe antiga (arquivada, mas o ledger dela nunca é tocado de
    // novo) e outra vez na classe nova que herdou o rateio. Só mexe neste
    // (year, month) — nunca em meses que este push não está recalculando.
    const idsAtivos = linhas.map((l) => l.class_id);
    const { error: zeraErr } = await db.from("invest_ledger")
      .update({ aporte: 0, updated_at: agora })
      .eq("user_id", userId).eq("year", year).eq("month", month)
      .not("class_id", "in", `(${idsAtivos.map((id) => JSON.stringify(id)).join(",")})`)
      .neq("aporte", 0);
    if (zeraErr) throw zeraErr;
  }

  /* Marcação a mercado manual: grava o saldo real de uma classe no mês que
     a calculadora está mostrando, sem mexer no aporte já calculado (lê
     antes de decidir entre update/insert — um upsert direto com aporte:0
     apagaria um aporte que já existia). `portfolio` é obrigatório desde que
     Meta e Independência podem ter uma classe com a mesma key (ex.: as duas
     têm uma "Renda Fixa") — sem ele, a busca por key sozinha poderia bater
     em mais de uma linha. */
  async function salvarSaldoReal(classKey, saldo, portfolio) {
    if (!userId) throw new Error("sem sessão ativa");
    const year = curYear;
    const month = curMonth + 1;
    const { data: cls, error: e1 } = await db.from("invest_classes")
      .select("id").eq("user_id", userId).eq("key", classKey).eq("portfolio", portfolio || "independencia").maybeSingle();
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

  async function pushPerfil() {
    const raw = localStorage.getItem(PERFIL_KEY);
    if (!raw) return;
    let p;
    try { p = JSON.parse(raw); } catch { return; }
    if (!p || !p.perfilKey) return;
    const { error } = await db.from("user_profile").upsert({
      user_id: userId,
      respostas: p.respostas || {},
      perfil_key: p.perfilKey,
      cats_pct: p.cats_pct || {},
      risco: p.risco || "moderado",
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw error;
  }

  /* `localKey` é a chave do localStorage (INV_KEY ou INV_KEY_META), `portfolio`
     o valor gravado na nuvem — as duas carteiras são independentes: apagar
     uma classe de Meta nunca arquiva uma classe de Independência com a
     mesma key, e vice-versa (por isso todo filtro abaixo inclui portfolio). */
  async function pushInvClasses(localKey, portfolio) {
    const raw = localStorage.getItem(localKey);
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
        portfolio,
      }));
      const { error } = await db.from("invest_classes").upsert(rows, { onConflict: "user_id,key,portfolio" });
      if (error) throw error;
    }

    // Arquiva na nuvem as classes que o usuário apagou no app. Soft-delete de
    // propósito: um DELETE físico cascatearia sobre invest_ledger e destruiria
    // o histórico de aportes. O upsert acima vem ANTES para que uma classe
    // recriada com a mesma key seja revivida, não re-arquivada.
    let q = db.from("invest_classes")
      .update({ archived: true })
      .eq("user_id", userId)
      .eq("portfolio", portfolio)
      .eq("archived", false);
    if (lista.length) {
      q = q.not("key", "in", `(${lista.map((c) => JSON.stringify(String(c.key))).join(",")})`);
    }
    const { error: archErr } = await q;
    if (archErr) throw archErr;
  }

  /* ── Indicador de sincronização ── */
  /* O usuário precisa SABER se o que digitou chegou na nuvem — falha só no
     console é perda de dado invisível pra quem não é programador. O elemento
     #sync-status (topbar do app.html) mostra salvando/salvo/erro; páginas
     sem ele (não deve haver) simplesmente não mostram nada. */
  function setStatus(estado) {
    const el = document.getElementById("sync-status");
    if (!el) return;
    // Sessão expirada é o diagnóstico certo — um retry falhando depois dela
    // não pode trocar o aviso por "sem conexão" (confundiria a causa).
    if (el.dataset.estado === "sessao" && estado !== "sessao") return;
    el.dataset.estado = estado;
    const mapa = {
      salvando: { texto: "Salvando…", cls: "" },
      salvo: { texto: "Salvo na nuvem ✓", cls: "ok" },
      erro: { texto: "⚠ Sem conexão — tentando de novo", cls: "erro" },
      sessao: { texto: "⚠ Sessão expirada", cls: "erro" },
    };
    const m = mapa[estado];
    el.textContent = m.texto;
    el.className = "sync-status " + m.cls;
    // "Salvo" some sozinho depois de um tempo; erro fica até resolver.
    clearTimeout(el._timer);
    if (estado === "salvo") el._timer = setTimeout(() => { el.textContent = ""; }, 3000);
  }

  /* ── Fila de escrita (debounced) ── */
  const RETRY_MS = 5000;
  async function flush() {
    flushTimer = null;
    // Um flush por vez: dois em paralelo (edição rápida + retry/online)
    // poderiam subir versões fora de ordem e a mais velha vencer na nuvem.
    if (flushing) {
      if (!flushTimer) flushTimer = setTimeout(flush, 200);
      return;
    }
    flushing = true;
    const keys = [...pending];
    pending.clear();
    persistPending();
    if (keys.length) setStatus("salvando");
    let falhou = false;
    try {
      for (const key of keys) {
        try {
          if (key === INV_KEY) await pushInvClasses(INV_KEY, "independencia");
          else if (key === INV_KEY_META) await pushInvClasses(INV_KEY_META, "meta");
          else if (key === PERFIL_KEY) await pushPerfil();
          else await pushMonthKey(key);
        } catch (err) {
          console.error("[store] falha ao sincronizar", key, err);
          pending.add(key);
          falhou = true;
        }
      }
    } finally {
      flushing = false;
      persistPending();
    }
    if (falhou) {
      setStatus("erro");
      // Antes, o retry só acontecia se o usuário editasse algo de novo — uma
      // oscilação de rede deixava o dado órfão pra sempre naquela sessão.
      if (!flushTimer) flushTimer = setTimeout(flush, RETRY_MS);
    } else if (keys.length) {
      setStatus("salvo");
    }
  }
  function queue(key) {
    pending.add(key);
    persistPending();
    if (!flushTimer) flushTimer = setTimeout(flush, 800);
  }

  // Rede voltou: sobe o que estiver pendente na hora, sem esperar o retry.
  window.addEventListener("online", () => {
    if (pending.size) { clearTimeout(flushTimer); flushTimer = null; flush(); }
  });
  // Saindo do app (troca de aba no celular, fechar janela): dispara o push
  // imediatamente em vez de esperar o debounce de 800ms — é a última chance
  // dos dados subirem antes do sistema congelar/matar a aba.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && pending.size) {
      clearTimeout(flushTimer); flushTimer = null; flush();
    }
  });
  // Fechar com pendência ainda não enviada: avisa (diálogo padrão do navegador).
  window.addEventListener("beforeunload", (e) => {
    if (pending.size) { e.preventDefault(); e.returnValue = ""; }
  });

  // Intercepta as gravações do app e replica as chaves "fin_*" para a nuvem.
  localStorage.setItem = function (key, value) {
    nativeSetItem(key, value);
    if (userId && (key === INV_KEY || key === INV_KEY_META || key === PERFIL_KEY || MONTH_RE.test(key))) queue(key);
  };

  /* ── Migração única: nuvem vazia + dados locais → sobe tudo ── */
  async function migrateIfNeeded(pulled) {
    if (pulled.monthCount > 0 || pulled.classCount > 0) return 0;
    const localKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === INV_KEY || k === INV_KEY_META || MONTH_RE.test(k)) localKeys.push(k);
    }
    for (const k of localKeys) {
      if (k === INV_KEY) await pushInvClasses(INV_KEY, "independencia");
      else if (k === INV_KEY_META) await pushInvClasses(INV_KEY_META, "meta");
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

  /* Correção única (ver commit 1e5f51f): contas que já tinham um aporte de
     Independência/Emergência apagado ANTES do fix ficaram com o ledger
     "preso" no valor antigo, inflando o patrimônio calculado sem aparecer
     em lugar nenhum na Calculadora. Roda pushInvestLedger só nos meses que
     JÁ estão com total zero — nunca nos que têm valor, então é impossível
     isso re-ratear um mês histórico pelas % de hoje (o bug que a Fase 3b
     existe pra evitar). Marca uma flag local pra rodar uma única vez. */
  async function corrigirLedgerFantasma() {
    if (localStorage.getItem("fin_ledger_fantasma_fixed")) return;
    const zerados = [];
    for (let i = 0; i < localStorage.length; i++) {
      const info = monthFromKey(localStorage.key(i));
      if (!info) continue;
      let md;
      try { md = JSON.parse(localStorage.getItem(localStorage.key(i))); } catch { continue; }
      const totalDe = (key) => {
        const cat = (md.cats || []).find((c) => c.key === key);
        return cat ? cat.items.reduce((s, it) => s + (parseFloat(it.value) || 0), 0) : 0;
      };
      if (totalDe("independencia") <= 0 && totalDe("meta") <= 0 && totalDe("emergencia") <= 0) zerados.push({ info, md });
    }
    // Cada mês mexe numa linha de ledger diferente (year/month distintos) —
    // não há conflito em rodar em paralelo, e isso evita que uma conta com
    // muito histórico demore vários round-trips seguidos só nesta correção
    // única, atrasando o primeiro carregamento do app.
    await Promise.all(zerados.map(({ info, md }) => pushInvestLedger(info.year, info.month, md.cats || [])));
    nativeSetItem("fin_ledger_fantasma_fixed", "1");
  }

  /* Sessão morreu com o app aberto (token vencido, senha trocada em outro
     aparelho): sem isso, o app continua aceitando lançamentos que nunca vão
     subir — e o pull do próximo login pode sobrescrevê-los. Um aviso claro
     na hora, com botão pra entrar de novo, é a diferença entre "perdi meus
     dados" e "ah, só precisei logar de novo". */
  function mostrarAvisoSessaoExpirada() {
    if (document.getElementById("sessao-expirada-aviso")) return;
    setStatus("sessao");
    const div = document.createElement("div");
    div.id = "sessao-expirada-aviso";
    div.className = "sessao-expirada-aviso";
    div.innerHTML = `
      <div class="sessao-expirada-box">
        <h3>Sua sessão expirou</h3>
        <p>Por segurança, você precisa entrar de novo. O que você digitou por último fica guardado neste aparelho e será enviado após o login.</p>
        <button class="btn btn-primary" type="button">Entrar de novo</button>
      </div>`;
    div.querySelector("button").addEventListener("click", () => {
      window.location.href = "auth.html";
    });
    document.body.appendChild(div);
  }

  async function init() {
    const user = await requireSession();
    if (!user) return;
    userId = user.id;
    db.auth.onAuthStateChange((event) => {
      // Logout intencional (botão Sair) também dispara SIGNED_OUT — o app.js
      // marca a flag antes pra não abrir o aviso em cima do redirecionamento.
      if (event === "SIGNED_OUT" && !window._logoutIntencional) mostrarAvisoSessaoExpirada();
    });
    // Edições que ficaram sem subir na sessão anterior (aba fechada com rede
    // caída, sessão vencida) sobem AGORA, antes do pull — é isso que torna
    // verdadeira a promessa do aviso de sessão ("será enviado após o login").
    // Se ainda falhar, o pull pula essas chaves e o retry continua tentando.
    restorePending();
    if (pending.size) await flush();
    let pulled = { monthCount: 0, classCount: 0 };
    try {
      pulled = await pull();
    } catch (err) {
      console.error("[store] erro ao baixar dados da nuvem", err);
      setStatus("erro");
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
    try {
      await corrigirLedgerFantasma();
    } catch (err) {
      console.error("[store] erro ao corrigir ledger fantasma", err);
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
    await pushInvClasses(INV_KEY, "independencia");
    await pushInvClasses(INV_KEY_META, "meta");
    const [classesIndep, classesMeta] = await Promise.all([
      buscarClassesAtivas("independencia"),
      buscarClassesAtivas("meta"),
    ]);
    if (!classesIndep.length && !classesMeta.length) return;
    const classes = { independencia: classesIndep, meta: classesMeta };

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

  /* Dados brutos para o motor de rendimento (motor.js) calcular o patrimônio
     real de UMA carteira: TODAS as classes daquela portfolio (inclusive
     arquivadas — dinheiro antigo nelas continua contando no patrimônio
     total) + o histórico do ledger daquelas classes. */
  async function buscarLedgerCompleto(portfolio) {
    const p = portfolio || "independencia";
    const { data: classes, error: e1 } = await db.from("invest_classes")
      .select("id, key, label, target_pct, color, expected_return_aa, archived")
      .eq("user_id", userId).eq("portfolio", p);
    if (e1) throw e1;
    const ids = (classes || []).map((c) => c.id);
    if (!ids.length) return { classes: [], ledger: [] };
    const { data: ledger, error: e2 } = await db.from("invest_ledger")
      .select("class_id, year, month, aporte, saldo_real")
      .eq("user_id", userId).in("class_id", ids);
    if (e2) throw e2;
    return { classes: classes || [], ledger: ledger || [] };
  }

  window.store = { ready: init(), salvarSaldoReal, garantirLedgerCompleto, buscarLedgerCompleto };
})();
