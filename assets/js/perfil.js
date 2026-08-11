/* perfil.js — cálculo do perfil financeiro (Fase B2).
 *
 * Funções puras: não leem localStorage nem Supabase, não tocam o DOM. A
 * regra é sempre a mesma ordem de prioridade (o primeiro critério que bater
 * decide o perfil, os outros nem são olhados):
 *   1. tem dívida cara            -> Saindo do Vermelho
 *   2. reserva não está completa  -> Construindo a Reserva
 *   3. tem uma meta específica    -> Meta de Curto/Médio Prazo
 *   4. objetivo é aposentar/render-> Acelerando Independência Financeira
 *   5. nenhum dos anteriores      -> Equilíbrio
 */

const PERFIS_BASE = {
  saindo_do_vermelho: {
    label: 'Saindo do Vermelho',
    catsPct: { independencia: 0, meta: 0, fixos: 60, variaveis: 20, conforto: 5, emergencia: 15 },
  },
  construindo_reserva: {
    label: 'Construindo a Reserva',
    catsPct: { independencia: 5, meta: 0, fixos: 55, variaveis: 20, conforto: 5, emergencia: 15 },
  },
  objetivo_meta: {
    label: 'Meta de Curto/Médio Prazo',
    catsPct: { independencia: 5, meta: 15, fixos: 45, variaveis: 20, conforto: 10, emergencia: 5 },
  },
  acelerando_if: {
    label: 'Acelerando Independência Financeira',
    catsPct: { independencia: 25, meta: 0, fixos: 45, variaveis: 20, conforto: 5, emergencia: 5 },
  },
  equilibrio: {
    label: 'Equilíbrio',
    catsPct: { independencia: 10, meta: 0, fixos: 55, variaveis: 20, conforto: 10, emergencia: 5 },
  },
};

/* Mix de classes de investimento por horizonte x tolerância a risco —
   nunca inclui a Reserva de Emergência (ela é liquidez, sempre 100% líquida,
   fora desse rateio). Usado pela Fase B3. */
const MIX_INVESTIMENTO = {
  curto: {
    conservador: { renda_fixa: 100, fii: 0, acoes: 0, exterior: 0 },
    moderado: { renda_fixa: 90, fii: 10, acoes: 0, exterior: 0 },
    arrojado: { renda_fixa: 80, fii: 20, acoes: 0, exterior: 0 },
  },
  medio: {
    conservador: { renda_fixa: 80, fii: 20, acoes: 0, exterior: 0 },
    moderado: { renda_fixa: 55, fii: 25, acoes: 20, exterior: 0 },
    arrojado: { renda_fixa: 40, fii: 25, acoes: 25, exterior: 10 },
  },
  longo: {
    conservador: { renda_fixa: 60, fii: 20, acoes: 20, exterior: 0 },
    moderado: { renda_fixa: 35, fii: 20, acoes: 30, exterior: 15 },
    arrojado: { renda_fixa: 20, fii: 20, acoes: 35, exterior: 25 },
  },
};

function calcularPerfilBase(respostas) {
  if (respostas.temDivida) return 'saindo_do_vermelho';
  if (respostas.reserva !== 'completa') return 'construindo_reserva';
  if (respostas.objetivo === 'meta') return 'objetivo_meta';
  if (respostas.objetivo === 'independencia' || respostas.objetivo === 'render') return 'acelerando_if';
  return 'equilibrio';
}

/* Meses de reserva alvo: base pela estabilidade da renda (fixa aguenta
   menos meses parada, variável precisa de mais colchão) + 1 mês por
   dependente a partir do 2º — é só informativo (mostra a meta em R$),
   não muda nenhuma % de categoria. */
function calcularMesesReserva(respostas) {
  const base = respostas.rendaFixa ? 6 : 9;
  const extra = Math.max(0, (respostas.dependentes || 0) - 1);
  return base + extra;
}

/* Horizonte do mix de investimento: só a Meta de Curto/Médio Prazo usa o
   horizonte que a pessoa respondeu (Q6) — pra qualquer outro perfil, o
   dinheiro que sobra é de longo prazo por natureza (aposentadoria/reserva
   de investimento), então usa sempre "longo". */
function calcularHorizonteInvestimento(perfilKey, respostas) {
  return perfilKey === 'objetivo_meta' ? (respostas.metaHorizonte || 'medio') : 'longo';
}

function calcularMixInvestimento(perfilKey, respostas) {
  const horizonte = calcularHorizonteInvestimento(perfilKey, respostas);
  const risco = respostas.risco || 'moderado';
  return (MIX_INVESTIMENTO[horizonte] && MIX_INVESTIMENTO[horizonte][risco]) || MIX_INVESTIMENTO.longo.moderado;
}

/* Junta tudo: o que fica salvo (respostas + resultado) e o que é só pra
   mostrar na tela de confirmação antes de aplicar. */
function calcularPerfilCompleto(respostas) {
  const perfilKey = calcularPerfilBase(respostas);
  const base = PERFIS_BASE[perfilKey];
  return {
    perfilKey,
    perfilLabel: base.label,
    catsPct: { ...base.catsPct },
    risco: respostas.risco || 'moderado',
    mesesReserva: calcularMesesReserva(respostas),
    mixInvestimento: calcularMixInvestimento(perfilKey, respostas),
    respostas,
  };
}
