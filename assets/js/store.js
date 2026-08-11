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
      db.from("invest_classes").select("key, label, target_pct, color, position, archived")
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
  }

  window.store = { ready: init() };
})();
