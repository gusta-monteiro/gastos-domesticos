/* motor.js — motor de rendimento (Fase 3a: cálculo puro).
 *
 * Regra de ouro: todo mês, o saldo que já existe rende ANTES de somar o
 * aporte novo — é isso que faz o juro composto funcionar direito. Quando
 * há saldo real informado (marcação a mercado), ele vira a verdade daquele
 * mês — o rendimento é derivado por diferença — e o motor volta a projetar
 * pela taxa esperada a partir dali.
 *
 * Este arquivo não lê localStorage nem Supabase e não é chamado pela UI
 * ainda — só funções puras, fáceis de testar isoladas.
 */

function taxaMensalEquivalente(taxaAnual) {
  // Perda >= 100% a.a. deixaria a base negativa; Math.pow com expoente
  // fracionário nesse caso é NaN silencioso. Perda total (base 0) é o piso.
  const base = Math.max(0, 1 + (taxaAnual || 0));
  return Math.pow(base, 1 / 12) - 1;
}

/* `meses` precisa ser contínuo e sem repetição — um mês faltando "engole"
   o aporte daquele mês sem avisar; um mês repetido conta o mesmo aporte
   duas vezes. Falha alto e cedo em vez de calcular um valor errado. */
function validarMeses(meses) {
  const vistos = new Set();
  meses.forEach(({ year, month }, i) => {
    const chave = year + '-' + month;
    if (vistos.has(chave)) throw new Error(`evoluirClasse: mês repetido em 'meses': ${chave}`);
    vistos.add(chave);
    if (i > 0) {
      const ant = meses[i - 1];
      const mesEsperado = ant.month === 12 ? 1 : ant.month + 1;
      const anoEsperado = ant.month === 12 ? ant.year + 1 : ant.year;
      if (year !== anoEsperado || month !== mesEsperado) {
        throw new Error(`evoluirClasse: 'meses' tem um buraco — esperava ${anoEsperado}-${mesEsperado} logo depois de ${ant.year}-${ant.month}, veio ${chave}`);
      }
    }
  });
}

/* Soma valores repetidos no mesmo mês (ex.: aporte programado + aporte
   extra manual) em vez de deixar um sobrescrever o outro silenciosamente. */
function somarPorMes(lista, campoValor) {
  const mapa = new Map();
  lista.forEach(item => {
    const chave = item.year + '-' + item.month;
    mapa.set(chave, (mapa.get(chave) || 0) + item[campoValor]);
  });
  return mapa;
}

/* aportes: [{ year, month, valor }] — meses sem aporte podem ser omitidos.
   saldosReais: [{ year, month, saldo }] — opcional, marcação a mercado.
   meses: [{ year, month }] contínuo e em ordem cronológica — o intervalo a calcular.
   Retorna um array paralelo a `meses`, um snapshot por mês. */
function evoluirClasse({ taxaAnual, aportes = [], saldosReais = [], meses, saldoInicial = 0 }) {
  validarMeses(meses);
  const taxa = taxaMensalEquivalente(taxaAnual);
  const aporteDoMes = somarPorMes(aportes, 'valor');

  // Dois saldos reais "concorrentes" no mesmo mês não têm como ser somados
  // (não são dois aportes, são duas leituras conflitantes de mercado) —
  // isso é erro de dado, não de cálculo, então falha em vez de escolher um.
  const saldoRealDoMes = new Map();
  saldosReais.forEach(s => {
    const chave = s.year + '-' + s.month;
    if (saldoRealDoMes.has(chave)) {
      throw new Error(`evoluirClasse: saldo real duplicado para ${chave}`);
    }
    saldoRealDoMes.set(chave, s.saldo);
  });

  let saldo = saldoInicial;
  const linhas = [];
  for (const { year, month } of meses) {
    const chave = year + '-' + month;
    const aporte = aporteDoMes.get(chave) || 0;
    const saldoReal = saldoRealDoMes.get(chave);

    let rendimento, saldoFechamento, fonte;
    if (saldoReal !== undefined) {
      rendimento = saldoReal - saldo - aporte;
      saldoFechamento = saldoReal;
      fonte = 'real';
    } else {
      rendimento = saldo * taxa;
      saldoFechamento = saldo + rendimento + aporte;
      fonte = 'projetado';
    }

    linhas.push({ year, month, saldoAbertura: saldo, aporte, rendimento, saldoFechamento, fonte });
    saldo = saldoFechamento;
  }
  return linhas;
}

/* Soma o patrimônio de várias classes no mesmo instante (última linha de
   cada evolução). Classes arquivadas entram normalmente — o saldo delas
   continua fazendo parte do patrimônio total mesmo sem receber aporte novo. */
function patrimonioTotal(evolucoesPorClasse) {
  return evolucoesPorClasse.reduce((soma, linhas) => {
    const ultima = linhas[linhas.length - 1];
    return soma + (ultima ? ultima.saldoFechamento : 0);
  }, 0);
}

/* Projeta N meses à frente a partir de um saldo conhecido, com aporte
   mensal constante — usado na tela de projeção futura (Fase 4). */
function projetarFuturo({ taxaAnual, saldoInicial, aporteMensal, meses }) {
  const taxa = taxaMensalEquivalente(taxaAnual);
  let saldo = saldoInicial;
  const linhas = [];
  for (let i = 1; i <= meses; i++) {
    const rendimento = saldo * taxa;
    saldo = saldo + rendimento + aporteMensal;
    linhas.push({ mes: i, rendimento, aporte: aporteMensal, saldoFechamento: saldo });
  }
  return linhas;
}
