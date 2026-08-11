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

/* Rendas sabidamente recorrentes MÊS A MÊS — basta 1 mês para sugerir no
   seguinte. Bônus anuais (13º, PLR) ficam de fora de propósito: sugeri-los
   logo depois de dezembro inflaria a renda de janeiro/fevereiro. */
const REC_RENDAS = [
  'salario', 'pagamento', 'pro labore', 'pro-labore', 'prolabore',
  'freela', 'freelance', 'rendimento', 'pensao', 'aposentadoria',
  'bolsa', 'vale', 'comissao',
];
/* Bônus anuais/irregulares: verificados ANTES da lista acima, porque um nome
   como "13º salário" contém a palavra "salário" e casaria por engano. */
const REC_RENDAS_EXCLUSAO = [
  '13', 'decimo terceiro', 'plr', 'participacao nos lucros', 'gratificacao natalina',
];
function recRendaConhecida(nome) {
  const n = recNorm(nome);
  if (!n) return false;
  if (REC_RENDAS_EXCLUSAO.some(t => n.includes(t))) return false;
  return REC_RENDAS.some(t => n.includes(t));
}

/* Varre os 3 meses anteriores a (m, y) e devolve sugestões que ainda não
   existem no mês atual: [{ catKey, name, value, tipo, meses }] */
function detectarRecorrentes(m, y) {
  const hist = new Map(); // "catKey|nome" -> { name, catKey, meses, valorRecente, maisRecente }
  let mm = m, yy = y;
  for (let i = 1; i <= 3; i++) {
    mm--; if (mm < 0) { mm = 11; yy--; }
    const md = loadMonth(mm, yy);
    const registrar = (catKey, it) => {
      // Parcelado tem rastreio próprio (garantirParcelasDoMes, em app.js) que já
      // carrega a parcela seguinte sozinho — ou já terminou (atual==total) e não
      // deve voltar. De qualquer forma, nunca é candidato a "recorrente" aqui,
      // senão uma dívida já quitada reaparece como sugestão de novo lançamento.
      if (it.parcela) return;
      const nn = recNorm(it.name);
      const val = parseFloat(it.value);
      if (!nn || !(val > 0)) return;
      const k = catKey + '|' + nn;
      if (!hist.has(k)) {
        // i=1 é o mês mais recente, então o primeiro registro traz o valor mais atual
        hist.set(k, { name: it.name, catKey, meses: 0, valorRecente: val, maisRecente: i });
      }
      hist.get(k).meses++;
    };
    md.cats.forEach(c => c.items.forEach(it => registrar(c.key, it)));
    (md.rendas || []).forEach(it => registrar('__rendas', it));
  }

  const atuais = new Set();
  const atual = loadMonth(m, y);
  atual.cats.forEach(c =>
    c.items.forEach(it => atuais.add(c.key + '|' + recNorm(it.name))));
  (atual.rendas || []).forEach(it => atuais.add('__rendas|' + recNorm(it.name)));

  const sugestoes = [];
  hist.forEach((h, k) => {
    if (atuais.has(k)) return;
    const ehRenda = h.catKey === '__rendas';
    const tipo = ehRenda
      ? (recRendaConhecida(h.name) ? 'renda' : null)
      : recTipoConhecido(h.name);
    const recorrentePorHistorico = h.meses >= 2;
    const recorrentePorConhecimento = tipo !== null && h.maisRecente <= 2;
    if (recorrentePorHistorico || recorrentePorConhecimento) {
      sugestoes.push({ catKey: h.catKey, name: h.name, value: h.valorRecente, tipo, meses: h.meses });
    }
  });

  return sugestoes.sort((a, b) => b.meses - a.meses || b.value - a.value);
}
