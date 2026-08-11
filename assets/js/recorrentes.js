/* recorrentes.js — detecção de gastos recorrentes SEM IA.
 *
 * Duas regras, nessa ordem:
 *   1. Histórico: item com o mesmo nome (normalizado) na mesma categoria em
 *      pelo menos 2 dos últimos 3 meses é recorrente, seja ele qual for.
 *   2. Base de conhecimento: serviços/contas sabidamente recorrentes (Netflix,
 *      luz, aluguel…) são sugeridos mesmo com uma única ocorrência recente.
 *
 * A categoria sugerida é sempre a que o próprio usuário usou da última vez —
 * a base só reconhece "isso é recorrente", nunca muda a categoria escolhida.
 */

const REC_CONHECIDOS = [
  { tipo: 'assinatura', match: [
    'netflix', 'spotify', 'disney', 'hbo', 'max', 'prime video', 'amazon prime',
    'globoplay', 'deezer', 'youtube premium', 'apple tv', 'apple music',
    'paramount', 'crunchyroll', 'game pass', 'xbox', 'playstation', 'ps plus',
    'icloud', 'google one', 'dropbox', 'office 365', 'microsoft 365',
    'chatgpt', 'claude', 'kindle',
  ]},
  { tipo: 'moradia', match: [
    'aluguel', 'condominio', 'iptu', 'financiamento', 'prestacao',
  ]},
  { tipo: 'conta da casa', match: [
    'luz', 'energia', 'enel', 'cemig', 'copel', 'celesc', 'cpfl', 'light',
    'agua', 'saneamento', 'sabesp', 'sanepar', 'gas', 'comgas',
  ]},
  { tipo: 'telecom', match: [
    'internet', 'fibra', 'vivo', 'claro', 'tim', 'oi', 'celular', 'telefone',
  ]},
  { tipo: 'saúde', match: [
    'academia', 'smartfit', 'smart fit', 'gympass', 'wellhub', 'pilates',
    'crossfit', 'plano de saude', 'unimed', 'amil', 'hapvida', 'notredame',
    'sulamerica', 'odonto', 'terapia', 'psicolog',
  ]},
  { tipo: 'educação', match: [
    'escola', 'faculdade', 'mensalidade', 'curso', 'creche', 'ingles',
  ]},
  { tipo: 'seguro', match: ['seguro'] },
  { tipo: 'pet', match: ['racao', 'petlove', 'petz', 'veterinari'] },
];

/* minúsculas + sem acentos, para comparar "Condomínio" com "condominio".
   Após normalize('NFD') os acentos viram marcas combinantes (U+0300–U+036F),
   removidas aqui por código — sem regex, imune a problemas de encoding. */
function recNorm(s) {
  const nfd = String(s || '').toLowerCase().normalize('NFD');
  let out = '';
  for (const ch of nfd) {
    const c = ch.charCodeAt(0);
    if (c < 0x0300 || c > 0x036f) out += ch;
  }
  return out.trim();
}

function recTipoConhecido(nome) {
  const n = recNorm(nome);
  if (!n) return null;
  for (const grupo of REC_CONHECIDOS) {
    for (const termo of grupo.match) {
      if (n.includes(termo)) return grupo.tipo;
    }
  }
  return null;
}

/* Varre os 3 meses anteriores a (m, y) e devolve sugestões que ainda não
   existem no mês atual: [{ catKey, name, value, tipo, meses }] */
function detectarRecorrentes(m, y) {
  const hist = new Map(); // "catKey|nome" -> { name, catKey, meses, valorRecente, maisRecente }
  let mm = m, yy = y;
  for (let i = 1; i <= 3; i++) {
    mm--; if (mm < 0) { mm = 11; yy--; }
    const md = loadMonth(mm, yy);
    md.cats.forEach(c => c.items.forEach(it => {
      const nn = recNorm(it.name);
      const val = parseFloat(it.value);
      if (!nn || !(val > 0)) return;
      const k = c.key + '|' + nn;
      if (!hist.has(k)) {
        // i=1 é o mês mais recente, então o primeiro registro traz o valor mais atual
        hist.set(k, { name: it.name, catKey: c.key, meses: 0, valorRecente: val, maisRecente: i });
      }
      hist.get(k).meses++;
    }));
  }

  const atuais = new Set();
  loadMonth(m, y).cats.forEach(c =>
    c.items.forEach(it => atuais.add(c.key + '|' + recNorm(it.name))));

  const sugestoes = [];
  hist.forEach((h, k) => {
    if (atuais.has(k)) return;
    const tipo = recTipoConhecido(h.name);
    const recorrentePorHistorico = h.meses >= 2;
    const recorrentePorConhecimento = tipo !== null && h.maisRecente <= 2;
    if (recorrentePorHistorico || recorrentePorConhecimento) {
      sugestoes.push({ catKey: h.catKey, name: h.name, value: h.valorRecente, tipo, meses: h.meses });
    }
  });

  return sugestoes.sort((a, b) => b.meses - a.meses || b.value - a.value);
}
