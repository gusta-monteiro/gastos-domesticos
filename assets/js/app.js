const CATS = [
  { key: 'independencia', label: 'Independência Financeira', pct: 10, color: '#1a1a18' },
  { key: 'fixos',         label: 'Custos Fixos',             pct: 55, color: '#5f5e5a' },
  { key: 'variaveis',     label: 'Custos Variáveis',         pct: 20, color: '#888780' },
  { key: 'conforto',      label: 'Conforto',                 pct: 10, color: '#b4b2a9' },
  { key: 'emergencia',    label: 'Reserva de Emergência',    pct:  5, color: '#d3d1c7' },
  // Sempre por último — todo código que casa CATS[ci] com md.cats[ci] por
  // índice depende disso pra não desalinhar categorias antigas já salvas.
  { key: 'meta',          label: 'Meta de Curto/Médio Prazo', pct:  0, color: '#a3824f' },
];
// Parcelamento (item.parcela = {atual, total}) só faz sentido em gasto —
// Independência/Reserva são aporte, não dívida.
const CATS_COM_PARCELA = new Set(['fixos', 'variaveis']);
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

let curMonth = new Date().getMonth();
let curYear  = new Date().getFullYear();
let pieChart = null, barChart = null, stackChart = null;
let pieRenda = 0; // renda do último render — o tooltip do gráfico lê daqui

/* ── Tema (modo escuro) ── */
function estaEscuro() { return typeof window.temaEscuro === 'function' && window.temaEscuro(); }
// Segmentos de pizza/doughnut ficam escuros demais pra distinguir do fundo
// escuro sem um contorno claro — no claro, sem contorno (como já era).
function corBordaSegmento() { return estaEscuro() ? 'rgba(255,255,255,0.12)' : 'transparent'; }
function corGradeGrafico() { return estaEscuro() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'; }
// Lê a cor de texto secundária direto da variável CSS — sempre em dia com o
// tema atual, sem duplicar os valores aqui.
function corTextoGrafico() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--text2').trim();
  return v || '#5f5e5a';
}
// Gráficos em <canvas> não repintam sozinhos quando o tema muda — refaz os
// que existem e redesenha a página visível, pra pegar as cores novas.
window.addEventListener('temamudou', () => {
  if (pieChart) { pieChart.destroy(); pieChart = null; }
  if (invPieChart) { invPieChart.destroy(); invPieChart = null; }
  const pagina = document.querySelector('.nav-item.active')?.dataset.page;
  if (pagina === 'calc') renderCalc();
  else if (pagina === 'period') renderPeriod();
  else if (pagina === 'invest') renderInvest();
});

/* ── Storage helpers ── */
function mKey(m, y) { return `${y}-${String(m+1).padStart(2,'0')}`; }
function loadMonth(m, y) {
  const raw = localStorage.getItem('fin_' + mKey(m, y));
  const d = raw ? JSON.parse(raw)
    : { renda: '', rendas: [], cats: CATS.map(c => ({ key: c.key, pct: pctPadrao(c.key), items: [] })) };
  // migração: meses antigos tinham só o número "renda"; viram uma entrada única
  if (!Array.isArray(d.rendas)) {
    d.rendas = (parseFloat(d.renda) > 0) ? [{ name: 'Renda', value: String(d.renda) }] : [];
  }
  // migração: meses antigos não tinham a categoria Meta — entra com 0% pra
  // não mudar o rateio de ninguém, sempre no fim (ver comentário em CATS).
  if (!d.cats.some(c => c.key === 'meta')) {
    d.cats.push({ key: 'meta', pct: 0, items: [] });
  }
  return d;
}
function totalRendas(md) {
  return (md.rendas || []).reduce((s, r) => s + (parseFloat(r.value) || 0), 0);
}

/* Ao abrir um mês pela 1ª vez (nunca salvo), copia pra ele os itens
   parcelados do último mês salvo anteriormente (não necessariamente o mês
   imediatamente anterior — se o app ficar sem ser aberto por um tempo,
   procura pra trás até achar onde a trilha parou) que ainda não
   terminaram, já com a parcela seguinte — só chamada pela navegação real
   da Calculadora (renderCalc), nunca durante leituras de histórico
   (Período/Relatório/recorrentes.js), senão criaria e gravaria meses
   "fantasma" só de estarem sendo varridos. */
function garantirParcelasDoMes(m, y) {
  const key = 'fin_' + mKey(m, y);
  if (localStorage.getItem(key)) return; // já existe, nada a fazer

  let mm = m, yy = y, anterior = null;
  for (let i = 0; i < 36; i++) { // limite generoso: 3 anos sem abrir o app
    mm--; if (mm < 0) { mm = 11; yy--; }
    const raw = localStorage.getItem('fin_' + mKey(mm, yy));
    if (raw) { try { anterior = JSON.parse(raw); } catch { anterior = null; } break; }
  }
  if (!anterior) return;

  const d = loadMonth(m, y);
  let mudou = false;
  for (const catKey of CATS_COM_PARCELA) {
    const catAnterior = (anterior.cats || []).find(c => c.key === catKey);
    const cat = d.cats.find(c => c.key === catKey);
    if (!catAnterior || !cat) continue;
    for (const it of (catAnterior.items || [])) {
      if (it && it.parcela && it.parcela.total > 0 && it.parcela.atual < it.parcela.total) {
        cat.items.push({ name: it.name, value: it.value, parcela: { atual: Number(it.parcela.atual) + 1, total: it.parcela.total } });
        mudou = true;
      }
    }
  }
  if (mudou) saveMonth(m, y, d);
}
function saveMonth(m, y, d) { localStorage.setItem('fin_' + mKey(m, y), JSON.stringify(d)); }

/* ── Formatting ── */
function fmt(v) {
  const n = parseFloat(v) || 0;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }

/* Converte o que o brasileiro digita num campo de dinheiro para número.
   Aceita "1.240,33", "1240,33", "1240.33", "1240" e "R$ 1.240,33".
   Regras de separador: vírgula é SEMPRE decimal; ponto é decimal quando é o
   único separador e tem 1-2 dígitos depois (é como os valores já salvos
   estão gravados: "1240.33"), e é separador de milhar em qualquer outro
   caso ("1.240" → 1240, "1.240.500" → 1240500, "1.240,33" → 1240.33).
   Retorna NaN para entrada que não é número (para o chamador decidir
   avisar), e 0 para vazio. */
function parseValorBR(str) {
  // Separador solto no fim ("1240," no meio da digitação) é número em
  // progresso, não erro — trata como se ainda não tivesse decimais.
  const s = String(str ?? '').replace(/[R$\s]/g, '').replace(/[.,]$/, '');
  if (s === '') return 0;
  const posV = s.lastIndexOf(','), posP = s.lastIndexOf('.');
  let normalizado;
  if (posV >= 0 && posP >= 0) {
    // Vírgula E ponto presentes: o que aparece POR ÚLTIMO é o decimal.
    // Cobre tanto "1.240,56" (brasileiro) quanto "1,240.56" colado de
    // fonte gringa — antes, o colado virava R$ 1,24 sem aviso.
    const dec = posV > posP ? ',' : '.';
    const semMilhar = s.split(dec === ',' ? '.' : ',').join('');
    if (semMilhar.split(dec).length > 2) return NaN; // decimal repetido
    normalizado = semMilhar.replace(dec, '.');
  } else if (posV >= 0) {
    if (s.indexOf(',') !== posV) return NaN; // mais de uma vírgula é erro
    normalizado = s.replace(',', '.');
  } else if (posP >= 0) {
    const umPontoSo = s.indexOf('.') === posP;
    const digitosApos = s.length - posP - 1;
    if (digitosApos <= 2) {
      // Último ponto com 1-2 dígitos depois é decimal — vale pro formato
      // interno salvo ("1240.33") e pro erro comum de digitar milhar e
      // decimal com ponto ("1.000.00" → 1000, não 100000).
      normalizado = s.slice(0, posP).split('.').join('') + '.' + s.slice(posP + 1);
    } else if (umPontoSo && /^0+\./.test(s)) {
      normalizado = s; // "0.125" só pode ser decimal
    } else {
      normalizado = s.split('.').join(''); // pontos de milhar ("1.240")
    }
  } else {
    normalizado = s;
  }
  if (!/^-?\d*\.?\d+$/.test(normalizado)) return NaN;
  return parseFloat(normalizado);
}

/* Formata um número (ou string canônica "1240.33") para exibição no campo:
   "1.240,33". Vazio/zero-por-vazio continua vazio (não força "0,00" num
   campo que o usuário deixou em branco). */
function fmtCampoBR(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = parseFloat(v);
  if (!isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/* Liga o comportamento de campo de dinheiro brasileiro num <input type=text
   inputmode=decimal>: no 'input' converte o texto pro valor canônico
   (string com ponto decimal, como sempre foi salvo) e entrega ao onValor;
   entrada não-numérica marca o campo em vermelho e entrega '' (nunca salva
   lixo silenciosamente). No blur, reformata bonito ("1.240,33"). */
function ligarCampoDinheiro(input, onValor) {
  // Entrada inválida NÃO sobrescreve o valor bom que já estava salvo — só
  // marca o campo; no blur, o campo volta pro último valor válido. (Gravar
  // '' num vacilo de tecla apagaria o valor em todos os aparelhos.)
  const inicial = parseValorBR(input.value);
  let ultimoValido = (isNaN(inicial) || input.value.trim() === '') ? '' : String(inicial);
  input.addEventListener('input', () => {
    const n = parseValorBR(input.value);
    if (isNaN(n) || n < 0) {
      input.classList.add('campo-invalido');
      return;
    }
    input.classList.remove('campo-invalido');
    ultimoValido = input.value.trim() === '' ? '' : String(n);
    onValor(ultimoValido);
  });
  input.addEventListener('blur', () => {
    const n = parseValorBR(input.value);
    if (isNaN(n) || n < 0) {
      input.value = fmtCampoBR(ultimoValido);
      input.classList.remove('campo-invalido');
    } else if (input.value.trim() !== '') {
      input.value = fmtCampoBR(n);
    }
  });
}
/* Escapa texto do usuário antes de entrar em innerHTML/atributos */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── Desfazer (toast) ── */
/* Apagar é irreversível demais pra não ter rede de segurança, mas modal de
   confirmação em toda exclusão cansa — o meio-termo é apagar na hora e
   oferecer "Desfazer" por alguns segundos. Um toast por vez (o mais novo
   substitui o anterior). */
let desfazerTimer = null;
function oferecerDesfazer(mensagem, aoDesfazer) {
  let toast = document.getElementById('undo-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'undo-toast';
    toast.className = 'undo-toast';
    document.body.appendChild(toast);
  }
  clearTimeout(desfazerTimer);
  toast.innerHTML = `<span class="undo-toast-msg"></span><button class="undo-toast-btn" type="button">Desfazer</button>`;
  toast.querySelector('.undo-toast-msg').textContent = mensagem;
  toast.classList.add('visivel');
  toast.querySelector('.undo-toast-btn').addEventListener('click', () => {
    clearTimeout(desfazerTimer);
    toast.classList.remove('visivel');
    aoDesfazer();
  });
  desfazerTimer = setTimeout(() => toast.classList.remove('visivel'), 6000);
}

/* ── Proteção contra a roda do mouse em campos numéricos ── */
/* Rolar a página com o cursor sobre um <input type=number> focado muda o
   valor silenciosamente (e o app salva na hora) — num app de dinheiro isso
   corrompe dados sem ninguém perceber. Tirar o foco no momento do scroll
   preserva a rolagem e impede a mudança. Os campos de dinheiro já viraram
   type=text (imunes); isso cobre os de % e parcela que continuam number. */
document.addEventListener('wheel', (e) => {
  // Só quando a roda gira EM CIMA do campo focado — é aí que o navegador
  // mudaria o valor. Rolar a página em outro lugar não pode roubar o foco.
  const el = document.activeElement;
  if (el && el.tagName === 'INPUT' && el.type === 'number' && e.target === el) el.blur();
}, { passive: true });

/* ── Navigation ── */
// No celular a barra lateral vira uma gaveta (ver main.css) — sem isso, não
// haveria como trocar de página, já que os itens só existem dentro dela.
function fecharMenuMobile() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-backdrop')?.classList.remove('open');
}
document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.add('open');
});
document.getElementById('sidebar-backdrop')?.addEventListener('click', fecharMenuMobile);

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    const pg = el.dataset.page;
    document.getElementById('page-' + pg).classList.add('active');
    document.getElementById('page-title').textContent = el.textContent.trim();
    document.getElementById('month-nav').style.display = pg === 'calc' ? 'flex' : 'none';
    if (pg === 'period') renderPeriod();
    if (pg === 'report') renderReport();
    if (pg === 'invest') renderInvest();
    fecharMenuMobile();
  });
});

// Desabilitados até a sincronização inicial terminar (ver "Init" no fim do
// arquivo) — navegar pra um mês nunca visitado antes disso faria pctPadrao()
// cair no padrão de fábrica em vez do perfil de verdade (que ainda não
// chegou da nuvem), travando esse mês errado assim que fosse editado.
document.getElementById('prev-month').disabled = true;
document.getElementById('next-month').disabled = true;
document.getElementById('prev-month').addEventListener('click', () => {
  curMonth--; if (curMonth < 0) { curMonth = 11; curYear--; }
  renderCalc();
});
document.getElementById('next-month').addEventListener('click', () => {
  curMonth++; if (curMonth > 11) { curMonth = 0; curYear++; }
  renderCalc();
});

/* ══ CALCULADORA ══ */
function renderCalc() {
  garantirParcelasDoMes(curMonth, curYear);
  const md = loadMonth(curMonth, curYear);
  document.getElementById('month-label').textContent = `${MONTHS[curMonth]} ${curYear}`;
  const renda = totalRendas(md);
  md.renda = String(renda); // campo legado: Período/Relatório continuam lendo daqui
  document.getElementById('renda-total').textContent = fmt(renda);
  renderRendas(md);
  renderMetrics(md, renda);
  renderCategories(md, renda);
  renderPie(md, renda);
  renderRecorrentes();
}

function renderRendas(md) {
  const container = document.getElementById('rendas');
  document.getElementById('rendas-total-lbl').textContent = fmt(totalRendas(md));

  container.innerHTML = `<div class="rendas-body">
    ${md.rendas.map((r, i) => `
      <div class="item-row">
        <input class="item-name" type="text" placeholder="Ex.: Salário" value="${esc(r.name)}" data-i="${i}">
        <input class="item-val" type="text" inputmode="decimal" placeholder="0,00" value="${esc(fmtCampoBR(r.value))}" data-i="${i}">
        <button class="del-btn" data-i="${i}"><i class="ti ti-x"></i></button>
      </div>`).join('')}
    <button class="add-item-btn" id="add-renda-btn"><i class="ti ti-plus"></i> Adicionar renda</button>
  </div>`;

  const persistir = () => {
    md.renda = String(totalRendas(md));
    saveMonth(curMonth, curYear, md);
  };
  // atualiza os números sem reconstruir o cartão (preserva o foco de quem digita)
  const atualizarValores = () => {
    const renda = totalRendas(md);
    document.getElementById('renda-total').textContent = fmt(renda);
    document.getElementById('rendas-total-lbl').textContent = fmt(renda);
    renderMetrics(md, renda);
    renderCategories(md, renda);
    renderPie(md, renda);
  };

  container.querySelectorAll('.item-name').forEach(inp => {
    inp.addEventListener('input', e => {
      md.rendas[parseInt(e.target.dataset.i)].name = e.target.value;
      persistir();
      renderRecorrentes(); // some da lista de sugestões o que o usuário acabou de digitar
    });
  });
  container.querySelectorAll('.item-val').forEach(inp => {
    ligarCampoDinheiro(inp, valor => {
      md.rendas[parseInt(inp.dataset.i)].value = valor;
      persistir();
      atualizarValores();
    });
  });
  container.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.i);
      const removida = md.rendas[i];
      md.rendas.splice(i, 1);
      persistir();
      renderCalc();
      // Prende o mês do momento da exclusão — o usuário pode navegar pra
      // outro mês nos 6s do toast, e o desfazer precisa devolver a renda
      // pro mês de onde ela saiu, não pro mês que estiver na tela.
      const mDel = curMonth, yDel = curYear;
      oferecerDesfazer(`Renda "${removida.name || 'sem nome'}" apagada`, () => {
        const mdAtual = loadMonth(mDel, yDel);
        mdAtual.rendas.splice(Math.min(i, mdAtual.rendas.length), 0, removida);
        mdAtual.renda = String(totalRendas(mdAtual));
        saveMonth(mDel, yDel, mdAtual);
        renderCalc();
      });
    });
  });
  document.getElementById('add-renda-btn').addEventListener('click', () => {
    md.rendas.push({ name: '', value: '' });
    persistir();
    renderCalc();
    const nomes = document.querySelectorAll('#rendas .item-name');
    if (nomes.length) nomes[nomes.length - 1].focus();
  });
}

function renderMetrics(md, renda) {
  const totalLancado = md.cats.reduce((s, c) => s + c.items.reduce((ss, it) => ss + (parseFloat(it.value)||0), 0), 0);
  const saldo = renda - totalLancado;
  const totalAlocado = md.cats.reduce((s, c) => s + renda * (parseFloat(c.pct)||0) / 100, 0);
  document.getElementById('metric-grid').innerHTML = `
    <div class="metric-card">
      <div class="metric-card-label">Renda</div>
      <div class="metric-card-val">${fmt(renda)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-card-label">Objetivo</div>
      <div class="metric-card-val">${fmt(totalAlocado)}</div>
      <div class="metric-card-sub">meta: ${pct(totalAlocado, renda)}% da renda</div>
    </div>
    <div class="metric-card">
      <div class="metric-card-label">Lançado</div>
      <div class="metric-card-val">${fmt(totalLancado)}</div>
      <div class="metric-card-sub">${pct(totalLancado, renda)}% da renda</div>
    </div>
    <div class="metric-card">
      <div class="metric-card-label">Saldo</div>
      <div class="metric-card-val ${saldo >= 0 ? 'green' : 'red'}">${fmt(saldo)}</div>
    </div>
  `;
}

function renderCategories(md, renda) {
  const totalPct = md.cats.reduce((s, c) => s + (parseFloat(c.pct)||0), 0);
  const warn = document.getElementById('pct-warning');
  if (totalPct > 100.01) {
    warn.style.display = 'block';
    warn.innerHTML = `<div class="pct-warning">⚠ Metas somam ${totalPct.toFixed(0)}% — acima de 100% da renda</div>`;
  } else { warn.style.display = 'none'; }
  document.getElementById('pct-total-lbl').textContent = `Meta: ${totalPct.toFixed(0)}%`;

  const container = document.getElementById('categories');
  container.innerHTML = '';
  md.cats.forEach((cat, ci) => {
    const def = CATS[ci];
    const pctVal = parseFloat(cat.pct) || 0;
    const alocado = renda * pctVal / 100;
    const lancado = cat.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0);
    const isOpen = sessionStorage.getItem('cat_' + def.key) === '1';

    const div = document.createElement('div');
    div.className = 'category';
    div.innerHTML = `
      <div class="cat-header">
        <span class="cat-dot" style="background:${def.color}"></span>
        <span class="cat-name">${def.label}</span>
        <div class="cat-pct-wrap">
          <input class="cat-pct-input" type="number" min="0" max="100" step="1" value="${cat.pct}">
          <span class="cat-pct-sym">%</span>
        </div>
        <span class="cat-value">${fmt(lancado)}<span class="cat-value-meta"> / ${fmt(alocado)}</span></span>
        <i class="ti ti-chevron-down cat-toggle ${isOpen ? 'open' : ''}"></i>
      </div>
      <div class="cat-items ${isOpen ? 'open' : ''}">
        ${cat.items.map((it, ii) => {
          const temParcela = it.parcela && it.parcela.total > 0;
          // Number(...)||1 blinda contra dado corrompido/editado fora do app
          // (ex: direto no Supabase) — nunca interpola texto arbitrário aqui.
          const pAtual = temParcela ? (Number(it.parcela.atual) || 1) : 1;
          const pTotal = temParcela ? (Number(it.parcela.total) || 1) : 1;
          return `
          <div class="item-block">
            <div class="item-row">
              <input class="item-name" type="text" placeholder="Descrição" value="${esc(it.name)}" data-ci="${ci}" data-ii="${ii}">
              ${temParcela ? `<span class="item-parcela-badge">${pAtual}/${pTotal}</span>` : ''}
              <input class="item-val" type="text" inputmode="decimal" placeholder="0,00" value="${esc(fmtCampoBR(it.value))}" data-ci="${ci}" data-ii="${ii}">
              ${CATS_COM_PARCELA.has(def.key) ? `<button class="item-parcela-toggle ${temParcela ? 'active' : ''}" data-ci="${ci}" data-ii="${ii}" title="É parcelado?"><i class="ti ti-calendar"></i></button>` : ''}
              <button class="del-btn" data-ci="${ci}" data-ii="${ii}"><i class="ti ti-x"></i></button>
            </div>
            ${temParcela ? `
              <div class="item-parcela-row">
                <span>Parcela</span>
                <input class="item-parcela-atual" type="number" min="1" value="${pAtual}" data-ci="${ci}" data-ii="${ii}">
                <span>de</span>
                <input class="item-parcela-total" type="number" min="1" value="${pTotal}" data-ci="${ci}" data-ii="${ii}">
              </div>
            ` : ''}
          </div>
        `;}).join('')}
        <button class="add-item-btn" data-ci="${ci}"><i class="ti ti-plus"></i> Adicionar item</button>
        ${lancado > 0 ? `<div class="cat-summary">Lançado: ${fmt(lancado)} / ${fmt(alocado)} (${pct(lancado,alocado)}%)</div>` : ''}
      </div>
    `;

    const header = div.querySelector('.cat-header');
    const itemsDiv = div.querySelector('.cat-items');
    const toggle = div.querySelector('.cat-toggle');

    header.addEventListener('click', e => {
      if (e.target.tagName === 'INPUT') return;
      const was = itemsDiv.classList.contains('open');
      itemsDiv.classList.toggle('open');
      toggle.classList.toggle('open');
      sessionStorage.setItem('cat_' + def.key, was ? '0' : '1');
    });

    div.querySelector('.cat-pct-input').addEventListener('change', e => {
      md.cats[ci].pct = parseFloat(e.target.value) || 0;
      saveMonth(curMonth, curYear, md);
      renderCalc();
    });

    div.querySelectorAll('.item-name').forEach(inp => {
      inp.addEventListener('input', e => {
        md.cats[parseInt(e.target.dataset.ci)].items[parseInt(e.target.dataset.ii)].name = e.target.value;
        saveMonth(curMonth, curYear, md);
        renderRecorrentes(); // some da lista de sugestões o que o usuário acabou de digitar
      });
    });
    div.querySelectorAll('.item-val').forEach(inp => {
      ligarCampoDinheiro(inp, valor => {
        md.cats[parseInt(inp.dataset.ci)].items[parseInt(inp.dataset.ii)].value = valor;
        saveMonth(curMonth, curYear, md);
        renderPie(md, parseFloat(md.renda)||0);
        renderMetrics(md, parseFloat(md.renda)||0);
      });
    });
    div.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ci2 = parseInt(btn.dataset.ci), ii2 = parseInt(btn.dataset.ii);
        const removido = md.cats[ci2].items[ii2];
        md.cats[ci2].items.splice(ii2, 1);
        saveMonth(curMonth, curYear, md);
        renderCalc();
        // Mesmo cuidado da renda: o desfazer devolve o item pro mês de onde
        // ele saiu, mesmo se o usuário navegar pra outro mês nesse meio tempo.
        const mDel = curMonth, yDel = curYear;
        oferecerDesfazer(`Item "${removido.name || 'sem nome'}" apagado`, () => {
          const mdAtual = loadMonth(mDel, yDel);
          const cat2 = mdAtual.cats[ci2];
          if (cat2) cat2.items.splice(Math.min(ii2, cat2.items.length), 0, removido);
          saveMonth(mDel, yDel, mdAtual);
          renderCalc();
        });
      });
    });
    div.querySelectorAll('.item-parcela-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const it = md.cats[parseInt(btn.dataset.ci)].items[parseInt(btn.dataset.ii)];
        if (it.parcela) delete it.parcela;
        else it.parcela = { atual: 1, total: 2 };
        saveMonth(curMonth, curYear, md);
        renderCalc();
      });
    });
    div.querySelectorAll('.item-parcela-atual').forEach(inp => {
      inp.addEventListener('change', e => {
        const it = md.cats[parseInt(e.target.dataset.ci)].items[parseInt(e.target.dataset.ii)];
        it.parcela.atual = Math.max(1, parseInt(e.target.value) || 1);
        saveMonth(curMonth, curYear, md);
        renderCalc();
      });
    });
    div.querySelectorAll('.item-parcela-total').forEach(inp => {
      inp.addEventListener('change', e => {
        const it = md.cats[parseInt(e.target.dataset.ci)].items[parseInt(e.target.dataset.ii)];
        it.parcela.total = Math.max(1, parseInt(e.target.value) || 1);
        saveMonth(curMonth, curYear, md);
        renderCalc();
      });
    });
    div.querySelectorAll('.add-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ci2 = parseInt(btn.dataset.ci);
        md.cats[ci2].items.push({ name: '', value: '' });
        saveMonth(curMonth, curYear, md);
        sessionStorage.setItem('cat_' + CATS[ci2].key, '1');
        renderCalc();
      });
    });

    container.appendChild(div);
  });
}

/* O gráfico mostra a distribuição REAL dos lançamentos; as porcentagens das
   categorias são apenas meta/objetivo. A fatia "Livre" é o que resta da renda. */
const LIVRE_COLOR = '#e7e6e0';

function renderPie(md, renda) {
  pieRenda = renda;
  const lancados = md.cats.map(c => c.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0));
  const totalLancado = lancados.reduce((s, v) => s + v, 0);
  const livre = Math.max(renda - totalLancado, 0);
  const vals = [...lancados, livre];
  document.getElementById('chart-center-val').textContent = fmt(totalLancado);

  if (pieChart) {
    pieChart.data.datasets[0].data = vals;
    pieChart.update();
  } else {
    pieChart = new Chart(document.getElementById('pieChart'), {
      type: 'doughnut',
      data: {
        labels: [...CATS.map(c => c.label), 'Livre'],
        datasets: [{
          data: vals,
          backgroundColor: [...CATS.map(c => c.color), LIVRE_COLOR],
          borderColor: corBordaSegmento(), borderWidth: estaEscuro() ? 1 : 0, hoverOffset: 4
        }]
      },
      options: {
        responsive: false, cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${fmt(ctx.raw)} (${pct(ctx.raw, pieRenda)}% da renda)` } }
        }
      }
    });
  }

  const rows = md.cats.map((cat, ci) => {
    const def = CATS[ci];
    return `<div class="leg-row">
      <span class="leg-dot" style="background:${def.color}"></span>
      <span class="leg-name">${def.label}</span>
      <span class="leg-val">${fmt(lancados[ci])}</span>
      <span class="leg-pct">${pct(lancados[ci], renda)}%</span>
      <span class="leg-meta">meta ${parseFloat(cat.pct)||0}%</span>
    </div>`;
  });
  rows.push(`<div class="leg-row">
      <span class="leg-dot" style="background:${LIVRE_COLOR}"></span>
      <span class="leg-name">Livre</span>
      <span class="leg-val">${fmt(livre)}</span>
      <span class="leg-pct">${pct(livre, renda)}%</span>
      <span class="leg-meta"></span>
    </div>`);
  document.getElementById('legend').innerHTML = rows.join('');
}

/* ── Sugestões de lançamentos recorrentes (detecção em recorrentes.js) ── */
function renderRecorrentes() {
  const panel = document.getElementById('recorrentes-panel');
  if (!panel) return;
  const sugs = (typeof detectarRecorrentes === 'function')
    ? detectarRecorrentes(curMonth, curYear) : [];
  if (!sugs.length) { panel.style.display = 'none'; panel.innerHTML = ''; return; }

  const catDe = k => k === '__rendas'
    ? { label: 'Renda', color: '#1a7a4a' }
    : (CATS.find(c => c.key === k) || { label: k, color: '#888780' });
  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="rec-card">
      <div class="rec-head">
        <span class="rec-title"><i class="ti ti-repeat"></i> Recorrentes de meses anteriores</span>
        <button class="btn" id="rec-add-all"><i class="ti ti-plus"></i> Adicionar todos</button>
      </div>
      ${sugs.map((s, i) => `
        <div class="rec-row">
          <span class="rec-dot" style="background:${catDe(s.catKey).color}"></span>
          <span class="rec-name">${esc(s.name)}</span>
          <span class="rec-tag">${s.tipo ? esc(s.tipo) : `repetiu ${s.meses}×`}</span>
          <span class="rec-cat">${esc(catDe(s.catKey).label)}</span>
          <span class="rec-val">${fmt(s.value)}</span>
          <button class="rec-add" data-i="${i}" title="Adicionar ao mês"><i class="ti ti-plus"></i></button>
        </div>`).join('')}
    </div>`;

  const aplicar = (lista) => {
    const md = loadMonth(curMonth, curYear);
    // Trava contra duplicata: o painel pode estar desatualizado (ex.: o usuário
    // digitou manualmente algo que já estava sugerido) — reconferimos aqui,
    // com os dados frescos do mês, antes de adicionar cada item.
    lista.forEach(s => {
      if (s.catKey === '__rendas') {
        const jaLancado = md.rendas.some(r => recNorm(r.name) === recNorm(s.name));
        if (jaLancado) return;
        md.rendas.push({ name: s.name, value: String(s.value) });
      } else {
        const cat = md.cats.find(c => c.key === s.catKey);
        if (!cat) return;
        const jaLancado = cat.items.some(it => recNorm(it.name) === recNorm(s.name));
        if (jaLancado) return;
        cat.items.push({ name: s.name, value: String(s.value) });
      }
    });
    md.renda = String(totalRendas(md));
    saveMonth(curMonth, curYear, md);
    renderCalc();
  };
  panel.querySelectorAll('.rec-add').forEach(b =>
    b.addEventListener('click', () => aplicar([sugs[parseInt(b.dataset.i)]])));
  document.getElementById('rec-add-all').addEventListener('click', () => aplicar(sugs));
}

/* ══ PERÍODO ══ */
function getPeriodMonths(n) {
  const result = [];
  let m = curMonth, y = curYear;
  for (let i = 0; i < n; i++) {
    result.unshift({ m, y });
    m--; if (m < 0) { m = 11; y--; }
  }
  return result;
}

function renderPeriod() {
  const n = parseInt(document.getElementById('period-select').value);
  const months = getPeriodMonths(n);
  const labels = months.map(({m, y}) => MONTHS[m].slice(0,3) + '/' + String(y).slice(2));
  const rendas = months.map(({m, y}) => parseFloat(loadMonth(m, y).renda)||0);
  const gastos = months.map(({m, y}) => {
    const d = loadMonth(m, y);
    return d.cats.reduce((s, c) => s + c.items.reduce((ss, it) => ss + (parseFloat(it.value)||0), 0), 0);
  });

  const totalRenda = rendas.reduce((s, v) => s + v, 0);
  const totalGasto = gastos.reduce((s, v) => s + v, 0);
  const mediaRenda = totalRenda / n;
  const mediaGasto = totalGasto / n;

  document.getElementById('period-metrics').innerHTML = `
    <div class="metric-card">
      <div class="metric-card-label">Renda total</div>
      <div class="metric-card-val">${fmt(totalRenda)}</div>
      <div class="metric-card-sub">Média: ${fmt(mediaRenda)}/mês</div>
    </div>
    <div class="metric-card">
      <div class="metric-card-label">Total gasto</div>
      <div class="metric-card-val">${fmt(totalGasto)}</div>
      <div class="metric-card-sub">Média: ${fmt(mediaGasto)}/mês</div>
    </div>
    <div class="metric-card">
      <div class="metric-card-label">Saldo período</div>
      <div class="metric-card-val ${totalRenda - totalGasto >= 0 ? 'green' : 'red'}">${fmt(totalRenda - totalGasto)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-card-label">Taxa de gasto</div>
      <div class="metric-card-val ${pct(totalGasto,totalRenda) > 90 ? 'red' : pct(totalGasto,totalRenda) > 75 ? 'amber' : 'green'}">${pct(totalGasto, totalRenda)}%</div>
      <div class="metric-card-sub">da renda total</div>
    </div>
  `;

  /* Bar chart */
  if (barChart) barChart.destroy();
  barChart = new Chart(document.getElementById('barChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Renda', data: rendas, backgroundColor: '#2C2C2A', borderColor: corBordaSegmento(), borderWidth: estaEscuro() ? 1 : 0 },
        { label: 'Gastos', data: gastos, backgroundColor: '#B4B2A9', borderColor: corBordaSegmento(), borderWidth: estaEscuro() ? 1 : 0 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { family: 'Inter', size: 11 }, color: corTextoGrafico(), autoSkip: false }, grid: { display: false } },
        y: { ticks: { font: { family: 'Inter', size: 11 }, color: corTextoGrafico(), callback: v => 'R$' + (v/1000).toFixed(0) + 'k' }, grid: { color: corGradeGrafico() } }
      }
    }
  });

  /* Stack chart */
  const catDatasets = CATS.map((def, ci) => ({
    label: def.label,
    data: months.map(({m, y}) => {
      const d = loadMonth(m, y);
      return d.cats[ci] ? d.cats[ci].items.reduce((s, it) => s + (parseFloat(it.value)||0), 0) : 0;
    }),
    backgroundColor: def.color,
    borderColor: corBordaSegmento(), borderWidth: estaEscuro() ? 1 : 0,
  }));

  if (stackChart) stackChart.destroy();
  stackChart = new Chart(document.getElementById('stackChart'), {
    type: 'bar',
    data: { labels, datasets: catDatasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { stacked: true, ticks: { font: { family: 'Inter', size: 11 }, color: corTextoGrafico(), autoSkip: false }, grid: { display: false } },
        y: { stacked: true, ticks: { font: { family: 'Inter', size: 11 }, color: corTextoGrafico(), callback: v => 'R$' + (v/1000).toFixed(0) + 'k' }, grid: { color: corGradeGrafico() } }
      }
    }
  });
}

document.getElementById('period-select').addEventListener('change', renderPeriod);

/* ══ RELATÓRIO ══ */
function renderReport() {
  const n = parseInt(document.getElementById('report-period').value);
  const months = getPeriodMonths(n);
  const data = months.map(({m, y}) => ({ label: `${MONTHS[m].slice(0,3)}/${y}`, md: loadMonth(m, y), m, y }));

  let html = '';

  /* Resumo por mês */
  html += `<div class="report-section-title">Resumo mensal</div>`;
  html += `<div class="table-scroll"><table class="report-table">
    <thead><tr>
      <th>Mês</th>
      <th class="num">Renda</th>
      <th class="num">Lançado</th>
      <th class="num">Saldo</th>
      <th class="num">Taxa</th>
    </tr></thead><tbody>`;
  data.forEach(({label, md}) => {
    const renda = parseFloat(md.renda)||0;
    const gasto = md.cats.reduce((s, c) => s + c.items.reduce((ss, it) => ss + (parseFloat(it.value)||0), 0), 0);
    const saldo = renda - gasto;
    const taxa = pct(gasto, renda);
    html += `<tr>
      <td>${label}</td>
      <td class="num">${fmt(renda)}</td>
      <td class="num">${fmt(gasto)}</td>
      <td class="num ${saldo >= 0 ? 'green' : 'red'}">${fmt(saldo)}</td>
      <td class="num">${taxa}%</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;

  /* Detalhamento por categoria */
  html += `<br><div class="report-section-title">Gastos por categoria</div>`;
  html += `<div class="table-scroll"><table class="report-table"><thead><tr><th>Categoria</th>${data.map(d => `<th class="num">${d.label}</th>`).join('')}</tr></thead><tbody>`;
  CATS.forEach((def, ci) => {
    html += `<tr><td>${def.label}</td>`;
    data.forEach(({md}) => {
      const v = md.cats[ci] ? md.cats[ci].items.reduce((s, it) => s + (parseFloat(it.value)||0), 0) : 0;
      html += `<td class="num">${fmt(v)}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table></div>`;

  document.getElementById('report-content').innerHTML = html;
  gerarParecer(months);
}

document.getElementById('report-period').addEventListener('change', renderReport);

/* ══ PARECER AUTOMÁTICO ══ */
function gerarParecer(months) {
  const data = months.map(({m, y}) => {
    const md = loadMonth(m, y);
    const renda = parseFloat(md.renda)||0;
    const gasto = md.cats.reduce((s, c) => s + c.items.reduce((ss, it) => ss + (parseFloat(it.value)||0), 0), 0);
    const catVals = md.cats.map((c, ci) => ({
      label: CATS[ci].label,
      pct: parseFloat(c.pct)||0,
      meta: CATS[ci].pct,
      lancado: c.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0),
      alocado: renda * (parseFloat(c.pct)||0) / 100,
    }));
    return { label: `${MONTHS[m].slice(0,3)}/${y}`, renda, gasto, saldo: renda - gasto, catVals };
  }).filter(d => d.renda > 0);

  if (data.length === 0) {
    document.getElementById('ai-output').textContent = 'Nenhum dado encontrado no período selecionado. Preencha a renda e os gastos nos meses para visualizar o parecer.';
    return;
  }

  const n = data.length;
  const totalRenda = data.reduce((s, d) => s + d.renda, 0);
  const totalGasto = data.reduce((s, d) => s + d.gasto, 0);
  const totalSaldo = totalRenda - totalGasto;
  const taxaMedia = totalRenda > 0 ? (totalGasto / totalRenda * 100) : 0;

  const mesesNegativo = data.filter(d => d.saldo < 0).length;
  const mesesPositivo = data.filter(d => d.saldo >= 0).length;

  let linhas = [];

  /* Diagnóstico geral */
  linhas.push('── Diagnóstico geral ──────────────────');
  if (taxaMedia <= 75) {
    linhas.push(`✔ Taxa média de gasto em ${taxaMedia.toFixed(1)}% da renda — dentro de um patamar saudável.`);
  } else if (taxaMedia <= 90) {
    linhas.push(`⚠ Taxa média de gasto em ${taxaMedia.toFixed(1)}% da renda — atenção, margem de segurança reduzida.`);
  } else {
    linhas.push(`✘ Taxa média de gasto em ${taxaMedia.toFixed(1)}% da renda — comprometimento elevado, revisar categorias.`);
  }

  if (mesesNegativo > 0) {
    linhas.push(`${mesesNegativo} de ${n} ${n === 1 ? 'mês' : 'meses'} analisados fechou no negativo.`);
  } else {
    linhas.push(`Todos os ${n} ${n === 1 ? 'mês analisado fechou' : 'meses analisados fecharam'} com saldo positivo.`);
  }

  linhas.push('');

  /* Análise por categoria (média dos meses com dados) */
  linhas.push('── Categorias vs. metas ───────────────');
  const catAgg = CATS.map((def, ci) => {
    const totalLancado = data.reduce((s, d) => s + (d.catVals[ci]?.lancado || 0), 0);
    const totalAlocado = data.reduce((s, d) => s + (d.catVals[ci]?.alocado || 0), 0);
    const uso = totalAlocado > 0 ? (totalLancado / totalAlocado * 100) : 0;
    return { label: def.label, pct: def.pct, uso, totalLancado, totalAlocado };
  });

  catAgg.forEach(c => {
    if (c.totalAlocado === 0) return;
    const icon = c.uso > 100 ? '✘' : c.uso > 85 ? '⚠' : '✔';
    const status = c.uso > 100 ? `acima do limite (${c.uso.toFixed(0)}% do alocado)` :
                   c.uso > 85  ? `próximo do limite (${c.uso.toFixed(0)}% do alocado)` :
                                 `dentro da meta (${c.uso.toFixed(0)}% do alocado)`;
    linhas.push(`${icon} ${c.label} — ${status}`);
  });

  linhas.push('');

  /* Recomendação */
  linhas.push('── Recomendação ───────────────────────');
  const maisEstourada = catAgg.filter(c => c.totalAlocado > 0).sort((a, b) => b.uso - a.uso)[0];
  const menorUso = catAgg.filter(c => c.totalAlocado > 0 && c.uso < 50).sort((a, b) => a.uso - b.uso)[0];

  if (maisEstourada && maisEstourada.uso > 100) {
    linhas.push(`Prioridade: revisar os gastos em "${maisEstourada.label}", que ultrapassou o alocado no período.`);
  } else if (taxaMedia > 85) {
    linhas.push('Reduzir custos variáveis e de conforto para ampliar a margem de saldo mensal.');
  } else {
    linhas.push('Comportamento financeiro estável. Considere aumentar a reserva de emergência ou o aporte em independência financeira.');
  }

  if (menorUso) {
    linhas.push(`A categoria "${menorUso.label}" foi pouco utilizada (${menorUso.uso.toFixed(0)}% do alocado) — avalie se a meta está bem calibrada.`);
  }

  document.getElementById('ai-output').textContent = linhas.join('\n');
}


/* ══ INVESTIMENTOS ══ */
const INV_CLASSES_DEFAULT = [
  { key: 'renda_fixa', label: 'Renda Fixa',    pct: 40, color: '#1a1a18', aa: 0.11 },
  { key: 'acoes',      label: 'Ações',          pct: 30, color: '#5f5e5a', aa: 0.12 },
  { key: 'fii',        label: 'FII',            pct: 20, color: '#888780', aa: 0.10 },
  { key: 'exterior',   label: 'Internacional',  pct: 10, color: '#b4b2a9', aa: 0.08 },
];
/* Reserva de Emergência é liquidez, não uma classe de risco: fica de fora
   do rateio por % das outras e recebe 100% do que for lançado em
   "emergencia" — nunca dividida entre Renda Fixa/Ações/etc. */
const RESERVA_KEY = 'reserva_emergencia';
const RESERVA_DEFAULT = { key: RESERVA_KEY, label: 'Reserva de Emergência', pct: 0, color: '#2f6f62', aa: 0.1025 };

let invPieChart = null;
let invAporteAtual = 0; // aporte do último render — o tooltip lê daqui

function loadInvClasses() {
  const raw = localStorage.getItem('fin_inv_classes');
  if (raw) return JSON.parse(raw);
  return [...INV_CLASSES_DEFAULT.map(c => ({ ...c })), { ...RESERVA_DEFAULT }];
}
function saveInvClasses(cls) { localStorage.setItem('fin_inv_classes', JSON.stringify(cls)); }
function classesDeInvestimento(todas) { return todas.filter(c => c.key !== RESERVA_KEY); }
function classeReserva(todas) { return todas.find(c => c.key === RESERVA_KEY); }

/* Carteira separada pra Meta de Curto/Médio Prazo (Fase C) — dinheiro de
   um objetivo de 1-2 anos não deveria correr o mesmo risco que aposentadoria
   de longo prazo, então mix inicial mais conservador. Sem Reserva aqui: ela
   é liquidez única, sempre na carteira de Independência. */
const INV_CLASSES_META_DEFAULT = [
  { key: 'renda_fixa', label: 'Renda Fixa', pct: 70, color: '#1a1a18', aa: 0.11 },
  { key: 'fii',        label: 'FII',        pct: 30, color: '#888780', aa: 0.10 },
];
function loadInvClassesMeta() {
  const raw = localStorage.getItem('fin_inv_classes_meta');
  if (raw) return JSON.parse(raw);
  return INV_CLASSES_META_DEFAULT.map(c => ({ ...c }));
}
function saveInvClassesMeta(cls) { localStorage.setItem('fin_inv_classes_meta', JSON.stringify(cls)); }

/* Pega os valores LANÇADOS nos itens de independencia, meta e emergencia do
   mês. "total" continua só indep+emerg (o que "Aporte do mês" sempre
   representou) — Meta é rastreada à parte, com sua própria carteira. */
function getInvLancados(m, y) {
  const md = loadMonth(m, y);
  const catIndep = md.cats.find(c => c.key === 'independencia');
  const catMeta = md.cats.find(c => c.key === 'meta');
  const catEmerg = md.cats.find(c => c.key === 'emergencia');
  const indep = catIndep ? catIndep.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0) : 0;
  const meta = catMeta ? catMeta.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0) : 0;
  const emerg = catEmerg ? catEmerg.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0) : 0;
  return { indep, meta, emerg, total: indep + emerg };
}

/* ── Patrimônio real (Fase 3c): motor.js aplicado ao histórico do ledger ── */
function construirMeses(anoIni, mesIni, anoFim, mesFim) {
  const out = [];
  let y = anoIni, m = mesIni;
  while (y < anoFim || (y === anoFim && m <= mesFim)) {
    out.push({ year: y, month: m });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/* Busca o ledger completo na nuvem e roda o motor de rendimento por classe
   (inclusive arquivadas — dinheiro antigo nelas continua contando no
   patrimônio total, só não aparece mais na lista editável de alocação).
   `meses` cobre do primeiro registro do ledger até o mês real de hoje —
   sempre contínuo, como o motor exige. */
async function carregarEvolucaoInvestimentos(portfolio) {
  if (!window.store || !window.store.buscarLedgerCompleto) return null;
  const { classes, ledger } = await window.store.buscarLedgerCompleto(portfolio);
  // null = "ainda sem dado" (aplicarPatrimonioReal não mexe na tela, mantém
  // os números chapados) — diferente de "patrimônio é zero de verdade", que
  // nunca é o caso aqui: se não há nem classe nem ledger, não há como saber.
  if (!classes.length || !ledger.length) return null;

  const hoje = new Date();
  const anoFim = hoje.getFullYear(), mesFim = hoje.getMonth() + 1;
  let anoIni = anoFim, mesIni = mesFim;
  ledger.forEach(l => {
    if (l.year < anoIni || (l.year === anoIni && l.month < mesIni)) { anoIni = l.year; mesIni = l.month; }
  });
  const meses = construirMeses(anoIni, mesIni, anoFim, mesFim);

  const porClasse = new Map();
  classes.forEach(c => {
    const aportes = ledger.filter(l => l.class_id === c.id)
      .map(l => ({ year: l.year, month: l.month, valor: parseFloat(l.aporte) || 0 }));
    const saldosReais = ledger.filter(l => l.class_id === c.id && l.saldo_real !== null && l.saldo_real !== undefined)
      .map(l => ({ year: l.year, month: l.month, saldo: parseFloat(l.saldo_real) }));
    const evolucao = evoluirClasse({ taxaAnual: parseFloat(c.expected_return_aa) || 0, aportes, saldosReais, meses });
    porClasse.set(c.key, { classe: c, evolucao });
  });

  const porMes = new Map();
  meses.forEach((mes, i) => {
    let patrimonio = 0, rendimento = 0;
    porClasse.forEach(({ evolucao }) => {
      const linha = evolucao[i];
      if (linha) { patrimonio += linha.saldoFechamento; rendimento += linha.rendimento; }
    });
    porMes.set(`${mes.year}-${mes.month}`, { patrimonio, rendimento });
  });

  return { porClasse, porMes };
}

/* Substitui os números chapados pelos reais assim que o cálculo chega —
   nunca bloqueia o primeiro render, só atualiza por cima. */
function aplicarPatrimonioReal(dados, todasClasses, classes, reserva, acumEmerg) {
  if (!dados) return;
  const { porClasse, porMes } = dados;

  let patrimonioTotalVal = 0, aportadoTotal = 0;
  porClasse.forEach(({ evolucao }) => {
    const ultima = evolucao[evolucao.length - 1];
    if (ultima) patrimonioTotalVal += ultima.saldoFechamento;
    aportadoTotal += evolucao.reduce((s, l) => s + l.aporte, 0);
  });
  const rendimentoAcumulado = patrimonioTotalVal - aportadoTotal;

  const valEl = document.getElementById('inv-patrimonio-val');
  const subEl = document.getElementById('inv-patrimonio-sub');
  if (valEl) valEl.textContent = fmt(patrimonioTotalVal);
  if (subEl) {
    subEl.textContent = rendimentoAcumulado >= 0
      ? `${fmt(rendimentoAcumulado)} de rendimento`
      : `${fmt(Math.abs(rendimentoAcumulado))} de perda projetada`;
  }

  const porClasseReal = new Map();
  classes.forEach(c => {
    const info = porClasse.get(c.key);
    const ultima = info && info.evolucao[info.evolucao.length - 1];
    porClasseReal.set(c.key, ultima ? ultima.saldoFechamento : 0);
  });
  renderInvSaldoClasses(classes, null, porClasseReal);

  if (reserva) {
    const infoReserva = porClasse.get(reserva.key);
    const ultimaReserva = infoReserva && infoReserva.evolucao[infoReserva.evolucao.length - 1];
    const { emerg } = getInvLancados(curMonth, curYear);
    // Sem "infoReserva" ainda (classe não sincronizada no instante da leitura),
    // passa undefined — não 0 — pra renderReserva cair no valor chapado real
    // (acumEmerg) em vez de exibir zero por engano.
    renderReserva(todasClasses, emerg, acumEmerg, infoReserva ? (ultimaReserva ? ultimaReserva.saldoFechamento : 0) : undefined);
  }

  renderInvHistory(porMes);
}

/* Carteira da Meta (Fase C): desenho inicial chapado (igual ao padrão já
   usado nas outras carteiras — nunca deixa a tela vazia esperando a rede).
   Retorna as classes carregadas pra quem chamou poder passar adiante. */
function renderInvestMeta(aporteMeta, acumMeta) {
  if (!localStorage.getItem('fin_inv_classes_meta')) saveInvClassesMeta(loadInvClassesMeta());
  const classesMeta = loadInvClassesMeta();
  document.getElementById('inv-meta-aporte-val').textContent = fmt(aporteMeta);
  document.getElementById('inv-meta-patrimonio-val').textContent = fmt(acumMeta);
  renderInvClassesMeta(classesMeta, aporteMeta);
  return classesMeta;
}

/* Substitui o patrimônio chapado da Meta pelo real (com juros) assim que
   chega — mesma ideia de aplicarPatrimonioReal, só que sem histórico/saldo
   por classe (a carteira da Meta é intencionalmente mais enxuta). */
function aplicarPatrimonioRealMeta(dados) {
  if (!dados) return;
  const { porClasse } = dados;
  let total = 0;
  porClasse.forEach(({ evolucao }) => {
    const ultima = evolucao[evolucao.length - 1];
    if (ultima) total += ultima.saldoFechamento;
  });
  const el = document.getElementById('inv-meta-patrimonio-val');
  if (el) el.textContent = fmt(total);
}

let invRenderSeq = 0; // trava contra resposta assíncrona desatualizada sobrescrever uma mais nova

function renderInvest() {
  const meuSeq = ++invRenderSeq;

  // Classes padrão só existem "na memória" até serem salvas — sem isso, o
  // motor de rendimento nunca teria onde escrever o aporte do mês. Persiste
  // na primeira visita à aba, uma única vez (não sobrescreve o que já existe).
  if (!localStorage.getItem('fin_inv_classes')) saveInvClasses(loadInvClasses());

  const todasClasses = loadInvClasses();
  const classes = classesDeInvestimento(todasClasses);
  const reserva = classeReserva(todasClasses);
  const { indep, meta, emerg, total } = getInvLancados(curMonth, curYear);

  document.getElementById('inv-month-lbl').textContent = `${MONTHS[curMonth]} ${curYear}`;

  /* Acumulado histórico: soma real de todos os meses, já separado por destino
     — Independência alimenta as classes de investimento, Emergência é caixa,
     Meta alimenta a carteira própria dela. */
  let acumIndep = 0, acumMeta = 0, acumEmerg = 0;
  const allKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('fin_20') || k.startsWith('fin_19')) allKeys.push(k);
  }
  allKeys.forEach(k => {
    const l = getInvLancadosFromRaw(JSON.parse(localStorage.getItem(k)));
    acumIndep += l.indep;
    acumMeta += l.meta;
    acumEmerg += l.emerg;
  });
  const acumTotal = acumIndep + acumEmerg;

  /* Cards topo */
  document.getElementById('invest-metrics').innerHTML = `
    <div class="metric-card">
      <div class="metric-card-label">Independência Financeira</div>
      <div class="metric-card-val">${fmt(indep)}</div>
      <div class="metric-card-sub">Lançado em ${MONTHS[curMonth]}</div>
    </div>
    <div class="metric-card">
      <div class="metric-card-label">Reserva de Emergência</div>
      <div class="metric-card-val">${fmt(emerg)}</div>
      <div class="metric-card-sub">Lançado em ${MONTHS[curMonth]}</div>
    </div>
    <div class="metric-card">
      <div class="metric-card-label">Aporte do mês</div>
      <div class="metric-card-val">${fmt(total)}</div>
      <div class="metric-card-sub">Soma dos dois</div>
    </div>
    <div class="metric-card">
      <div class="metric-card-label">Patrimônio</div>
      <div class="metric-card-val green" id="inv-patrimonio-val">${fmt(acumTotal)}</div>
      <div class="metric-card-sub" id="inv-patrimonio-sub">calculando rendimento...</div>
    </div>
  `;

  renderInvAporteRows(indep, emerg, total);
  renderInvClasses(todasClasses, indep);
  renderInvPie(classes, indep);
  renderInvHistory();
  renderInvSaldoClasses(classes, acumIndep);
  renderReserva(todasClasses, emerg, acumEmerg);
  const classesMeta = renderInvestMeta(meta, acumMeta);

  // Toda visita a esta aba também garante que o mês real de hoje está
  // sincronizado e preenche qualquer mês antigo sem registro no ledger —
  // sem nunca reescrever um mês que já tem ledger gravado (ver store.js).
  // A LEITURA (carregarEvolucaoInvestimentos) só começa DEPOIS da escrita
  // terminar — as duas rodando em paralelo é o que fazia a leitura vencer
  // a corrida e mostrar patrimônio zerado no primeiro acesso.
  const sincronizar = (window.store && window.store.garantirLedgerCompleto)
    ? window.store.garantirLedgerCompleto().catch(err => console.error('[invest] erro ao sincronizar aportes', err))
    : Promise.resolve();

  // Substitui os números chapados acima pelos reais (com juros) assim que
  // o cálculo chegar — sem bloquear o primeiro desenho da tela. Se, enquanto
  // isso, uma visita mais nova a esta aba já rodou (meuSeq desatualizado),
  // descarta o resultado em vez de sobrescrever o que já está mais atual.
  sincronizar
    .then(() => carregarEvolucaoInvestimentos('independencia'))
    .then(dados => {
      if (meuSeq !== invRenderSeq) return;
      aplicarPatrimonioReal(dados, todasClasses, classes, reserva, acumEmerg);
    })
    .catch(err => console.error('[invest] erro ao calcular patrimônio real', err));

  // Mesma lógica, carteira separada — nunca se mistura com a de cima.
  sincronizar
    .then(() => carregarEvolucaoInvestimentos('meta'))
    .then(dados => {
      if (meuSeq !== invRenderSeq) return;
      aplicarPatrimonioRealMeta(dados);
    })
    .catch(err => console.error('[invest] erro ao calcular patrimônio real da meta', err));
}

function getInvLancadosFromRaw(md) {
  const catIndep = md.cats.find(c => c.key === 'independencia');
  const catMeta = md.cats.find(c => c.key === 'meta');
  const catEmerg = md.cats.find(c => c.key === 'emergencia');
  const indep = catIndep ? catIndep.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0) : 0;
  const meta = catMeta ? catMeta.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0) : 0;
  const emerg = catEmerg ? catEmerg.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0) : 0;
  return { indep, meta, emerg, total: indep + emerg };
}

function renderInvAporteRows(indep, emerg, total) {
  const container = document.getElementById('inv-aporte-rows');
  const md = loadMonth(curMonth, curYear);
  const catIndep = md.cats.find(c => c.key === 'independencia');
  const catEmerg = md.cats.find(c => c.key === 'emergencia');

  function buildRows(cat, catLabel, dotColor) {
    if (!cat || cat.items.length === 0) {
      return `<div style="font-size:12px;color:var(--text3);padding:4px 0">Nenhum item lançado em <strong>${catLabel}</strong> neste mês.</div>`;
    }
    const subtotal = cat.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0);
    return `
      <div style="margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:6px">
          <span style="width:7px;height:7px;border-radius:50%;background:${dotColor};flex-shrink:0"></span>
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text2)">${catLabel}</span>
          <span style="margin-left:auto;font-size:12px;font-weight:500">${fmt(subtotal)}</span>
        </div>
        ${cat.items.map(it => `
          <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0 3px 14px;border-bottom:0.5px solid var(--border)">
            <span style="color:var(--text2)">${esc(it.name) || '—'}</span>
            <span style="font-weight:500">${fmt(it.value)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  container.innerHTML =
    buildRows(catIndep, 'Independência Financeira', '#1a1a18') +
    '<div style="margin:8px 0;border-top:0.5px solid var(--border)"></div>' +
    buildRows(catEmerg, 'Reserva de Emergência', '#888780') +
    (total > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;margin-top:4px">
      <span style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Total do mês</span>
      <span style="font-size:15px;font-weight:500">${fmt(total)}</span>
    </div>` : '');
}

/* Um input de "saldo real" que salva na nuvem ao perder o foco, com um
   pequeno retorno visual — reaproveitado pelas classes e pela reserva.
   `portfolio` é obrigatório desde a Fase C: Meta e Independência podem ter
   uma classe com a mesma key. */
function ligarSaldoReal(container, classKey, portfolio) {
  const input = container.querySelector('.inv-saldo-real-input');
  const msg = container.querySelector('.inv-saldo-real-msg');
  input.addEventListener('change', async e => {
    if (e.target.value.trim() === '') { msg.textContent = ''; return; }
    const valor = parseValorBR(e.target.value);
    // Entrada que não vira número (ou negativa) precisa de resposta — sumir
    // em silêncio faz o usuário achar que o patrimônio foi registrado.
    if (isNaN(valor) || valor < 0) {
      msg.textContent = 'Valor inválido — use números, ex.: 1.240,33';
      msg.className = 'inv-saldo-real-msg erro';
      return;
    }
    e.target.value = fmtCampoBR(valor);
    msg.textContent = 'Salvando...';
    msg.className = 'inv-saldo-real-msg';
    try {
      await window.store.salvarSaldoReal(classKey, valor, portfolio);
      msg.textContent = 'Salvo ✓';
      msg.className = 'inv-saldo-real-msg ok';
    } catch (err) {
      msg.textContent = 'Erro ao salvar — tente de novo';
      msg.className = 'inv-saldo-real-msg erro';
    }
  });
}

function renderInvClasses(todasClasses, aporte) {
  const classes = classesDeInvestimento(todasClasses);
  const totalPct = classes.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0);
  const warn = document.getElementById('inv-pct-warning');
  if (totalPct > 100.01) {
    warn.style.display = 'block';
    warn.innerHTML = `<div class="pct-warning">⚠ Porcentagens somam ${totalPct.toFixed(0)}% — acima de 100%</div>`;
  } else { warn.style.display = 'none'; }
  document.getElementById('inv-pct-lbl').textContent = `${totalPct.toFixed(0)}% alocados`;

  const container = document.getElementById('inv-classes');
  container.innerHTML = '';
  classes.forEach(cls => {
    // Rateia pela soma real das % (totalPct), não por 100 fixo — o aviso
    // acima é só um alerta, nunca impediu o usuário de salvar acima/abaixo
    // de 100%, então o valor exibido precisa bater com o que é gravado.
    const val = totalPct > 0 ? aporte * (parseFloat(cls.pct)||0) / totalPct : 0;
    const aaPct = fmtCampoBR((parseFloat(cls.aa)||0) * 100);
    const div = document.createElement('div');
    div.className = 'category';
    div.innerHTML = `
      <div class="cat-header" style="cursor:default">
        <span class="cat-dot" style="background:${cls.color}"></span>
        <input class="item-name" type="text" value="${esc(cls.label)}" placeholder="Classe" style="font-size:12px;font-weight:500;max-width:130px">
        <div class="cat-pct-wrap" style="margin-left:auto">
          <input class="cat-pct-input" type="number" min="0" max="100" step="1" value="${cls.pct}">
          <span class="cat-pct-sym">%</span>
        </div>
        <span class="cat-value">${fmt(val)}</span>
        <button class="del-btn" title="Remover"><i class="ti ti-x"></i></button>
      </div>
      <div class="inv-class-extra">
        <label>Taxa esperada<input class="inv-aa-input" type="text" inputmode="decimal" value="${aaPct}"> % a.a.</label>
        <label>Saldo real<input class="inv-saldo-real-input" type="text" inputmode="decimal" placeholder="Opcional"></label>
        <span class="inv-saldo-real-msg"></span>
      </div>
    `;
    div.querySelector('.item-name').addEventListener('input', e => {
      cls.label = e.target.value;
      saveInvClasses(todasClasses);
      renderInvPie(classes, aporte);
      renderInvSaldoClasses(classes, null);
    });
    div.querySelector('.cat-pct-input').addEventListener('change', e => {
      cls.pct = parseFloat(e.target.value) || 0;
      saveInvClasses(todasClasses);
      renderInvest();
    });
    div.querySelector('.inv-aa-input').addEventListener('change', e => {
      const taxa = parseValorBR(e.target.value);
      if (isNaN(taxa)) return; // não sobrescreve a taxa com lixo
      cls.aa = taxa / 100;
      e.target.value = fmtCampoBR(taxa);
      saveInvClasses(todasClasses);
    });
    div.querySelector('.del-btn').addEventListener('click', () => {
      // Sem nenhuma classe de investimento, o aporte de Independência
      // ficaria sem destino nenhum — mantém sempre pelo menos uma.
      if (classes.length <= 1) {
        warn.style.display = 'block';
        warn.innerHTML = `<div class="pct-warning">⚠ Mantenha pelo menos uma classe de investimento</div>`;
        return;
      }
      const idx = todasClasses.findIndex(c => c.key === cls.key);
      if (idx >= 0) todasClasses.splice(idx, 1);
      saveInvClasses(todasClasses);
      renderInvest();
      oferecerDesfazer(`Classe "${cls.label}" removida`, () => {
        const atuais = loadInvClasses();
        if (!atuais.some(c => c.key === cls.key)) {
          atuais.splice(Math.min(idx, atuais.length), 0, cls);
          saveInvClasses(atuais);
        }
        renderInvest();
      });
    });
    ligarSaldoReal(div, cls.key, 'independencia');
    container.appendChild(div);
  });

  const addWrap = document.createElement('div');
  addWrap.style.cssText = 'padding:0.6rem 1.25rem;border-top:0.5px solid var(--border)';
  addWrap.innerHTML = `<button class="add-item-btn" id="inv-add-class"><i class="ti ti-plus"></i> Adicionar classe</button>`;
  container.appendChild(addWrap);
  document.getElementById('inv-add-class').addEventListener('click', () => {
    const palette = ['#2C2C2A','#5f5e5a','#888780','#b4b2a9','#d3d1c7','#444441'];
    todasClasses.push({ key: 'cls_' + Date.now(), label: 'Nova classe', pct: 0, color: palette[classes.length % palette.length], aa: 0 });
    saveInvClasses(todasClasses);
    renderInvest();
  });
}

/* Mesma ideia de renderInvClasses, carteira separada da Meta de
   Curto/Médio Prazo — sem Reserva (ela nunca faz parte disso, é liquidez
   única e sempre fica na carteira de Independência). */
function renderInvClassesMeta(classesMeta, aporte) {
  const totalPct = classesMeta.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0);
  const warn = document.getElementById('inv-meta-pct-warning');
  if (totalPct > 100.01) {
    warn.style.display = 'block';
    warn.innerHTML = `<div class="pct-warning">⚠ Porcentagens somam ${totalPct.toFixed(0)}% — acima de 100%</div>`;
  } else { warn.style.display = 'none'; }
  document.getElementById('inv-meta-pct-lbl').textContent = `${totalPct.toFixed(0)}% alocados`;

  const container = document.getElementById('inv-classes-meta');
  container.innerHTML = '';
  classesMeta.forEach(cls => {
    const val = totalPct > 0 ? aporte * (parseFloat(cls.pct)||0) / totalPct : 0;
    const aaPct = fmtCampoBR((parseFloat(cls.aa)||0) * 100);
    const div = document.createElement('div');
    div.className = 'category';
    div.innerHTML = `
      <div class="cat-header" style="cursor:default">
        <span class="cat-dot" style="background:${cls.color}"></span>
        <input class="item-name" type="text" value="${esc(cls.label)}" placeholder="Classe" style="font-size:12px;font-weight:500;max-width:130px">
        <div class="cat-pct-wrap" style="margin-left:auto">
          <input class="cat-pct-input" type="number" min="0" max="100" step="1" value="${cls.pct}">
          <span class="cat-pct-sym">%</span>
        </div>
        <span class="cat-value">${fmt(val)}</span>
        <button class="del-btn" title="Remover"><i class="ti ti-x"></i></button>
      </div>
      <div class="inv-class-extra">
        <label>Taxa esperada<input class="inv-aa-input" type="text" inputmode="decimal" value="${aaPct}"> % a.a.</label>
        <label>Saldo real<input class="inv-saldo-real-input" type="text" inputmode="decimal" placeholder="Opcional"></label>
        <span class="inv-saldo-real-msg"></span>
      </div>
    `;
    div.querySelector('.item-name').addEventListener('input', e => {
      cls.label = e.target.value;
      saveInvClassesMeta(classesMeta);
    });
    div.querySelector('.cat-pct-input').addEventListener('change', e => {
      cls.pct = parseFloat(e.target.value) || 0;
      saveInvClassesMeta(classesMeta);
      renderInvest();
    });
    div.querySelector('.inv-aa-input').addEventListener('change', e => {
      const taxa = parseValorBR(e.target.value);
      if (isNaN(taxa)) return; // não sobrescreve a taxa com lixo
      cls.aa = taxa / 100;
      e.target.value = fmtCampoBR(taxa);
      saveInvClassesMeta(classesMeta);
    });
    div.querySelector('.del-btn').addEventListener('click', () => {
      // Sem nenhuma classe, o aporte da Meta ficaria sem destino nenhum —
      // mantém sempre pelo menos uma.
      if (classesMeta.length <= 1) {
        warn.style.display = 'block';
        warn.innerHTML = `<div class="pct-warning">⚠ Mantenha pelo menos uma classe</div>`;
        return;
      }
      const idx = classesMeta.findIndex(c => c.key === cls.key);
      if (idx >= 0) classesMeta.splice(idx, 1);
      saveInvClassesMeta(classesMeta);
      renderInvest();
      oferecerDesfazer(`Classe "${cls.label}" removida`, () => {
        const atuais = loadInvClassesMeta();
        if (!atuais.some(c => c.key === cls.key)) {
          atuais.splice(Math.min(idx, atuais.length), 0, cls);
          saveInvClassesMeta(atuais);
        }
        renderInvest();
      });
    });
    ligarSaldoReal(div, cls.key, 'meta');
    container.appendChild(div);
  });

  const addWrap = document.createElement('div');
  addWrap.style.cssText = 'padding:0.6rem 1.25rem;border-top:0.5px solid var(--border)';
  addWrap.innerHTML = `<button class="add-item-btn" id="inv-add-class-meta"><i class="ti ti-plus"></i> Adicionar classe</button>`;
  container.appendChild(addWrap);
  document.getElementById('inv-add-class-meta').addEventListener('click', () => {
    const palette = ['#2C2C2A','#5f5e5a','#888780','#b4b2a9','#d3d1c7','#444441'];
    classesMeta.push({ key: 'cls_' + Date.now(), label: 'Nova classe', pct: 0, color: palette[classesMeta.length % palette.length], aa: 0 });
    saveInvClassesMeta(classesMeta);
    renderInvest();
  });
}

/* Reserva de Emergência: card separado, sem % de rateio — recebe 100% do
   que for lançado em "emergencia" e tem sua própria taxa esperada. */
function renderReserva(todasClasses, aporteMes, acumEmerg, saldoReal) {
  const container = document.getElementById('inv-reserva');
  if (!container) return;
  const reserva = classeReserva(todasClasses);
  if (!reserva) { container.innerHTML = ''; return; }
  const aaPct = fmtCampoBR((parseFloat(reserva.aa)||0) * 100);
  const acumExibido = (saldoReal === null || saldoReal === undefined) ? acumEmerg : saldoReal;

  container.innerHTML = `
    <div class="reserva-row">
      <div>
        <div class="reserva-label">Aporte deste mês</div>
        <div class="reserva-val">${fmt(aporteMes)}</div>
      </div>
      <div>
        <div class="reserva-label">Acumulado</div>
        <div class="reserva-val green">${fmt(acumExibido)}</div>
      </div>
    </div>
    <div class="inv-class-extra">
      <label>Taxa esperada<input class="inv-aa-input" type="text" inputmode="decimal" value="${aaPct}"> % a.a.</label>
      <label>Saldo real<input class="inv-saldo-real-input" type="text" inputmode="decimal" placeholder="Opcional"></label>
      <span class="inv-saldo-real-msg"></span>
    </div>
  `;
  container.querySelector('.inv-aa-input').addEventListener('change', e => {
    const taxa = parseValorBR(e.target.value);
    if (isNaN(taxa)) return; // não sobrescreve a taxa com lixo
    reserva.aa = taxa / 100;
    e.target.value = fmtCampoBR(taxa);
    saveInvClasses(todasClasses);
  });
  ligarSaldoReal(container, reserva.key, 'independencia');
}

function renderInvPie(classes, aporte) {
  invAporteAtual = aporte;
  // Rateia pela soma real das % — assim o centro do gráfico sempre bate com
  // o aporte de verdade, mesmo se as % configuradas não somarem 100%.
  const somaPct = classes.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0);
  const vals = classes.map(c => somaPct > 0 ? aporte * (parseFloat(c.pct)||0) / somaPct : 0);
  const colors = classes.map(c => c.color);
  const totalVal = vals.reduce((s, v) => s + v, 0);
  document.getElementById('inv-chart-center').textContent = fmt(totalVal);

  if (invPieChart) {
    invPieChart.data.labels = classes.map(c => c.label);
    invPieChart.data.datasets[0].data = vals;
    invPieChart.data.datasets[0].backgroundColor = colors;
    invPieChart.update();
  } else {
    invPieChart = new Chart(document.getElementById('invPieChart'), {
      type: 'doughnut',
      data: {
        labels: classes.map(c => c.label),
        datasets: [{ data: vals, backgroundColor: colors, borderColor: corBordaSegmento(), borderWidth: estaEscuro() ? 1 : 0, hoverOffset: 4 }]
      },
      options: {
        responsive: false, cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${fmt(ctx.raw)} (${invAporteAtual > 0 ? Math.round(ctx.raw/invAporteAtual*100) : 0}%)` } }
        }
      }
    });
  }

  document.getElementById('inv-legend').innerHTML = classes.map((cls, ci) => `
    <div class="leg-row">
      <span class="leg-dot" style="background:${cls.color}"></span>
      <span class="leg-name">${esc(cls.label)}</span>
      <span class="leg-val">${fmt(vals[ci])}</span>
      <span class="leg-pct">${parseFloat(cls.pct)||0}%</span>
    </div>`).join('');
}

/* porMes: Map("year-month" -> {patrimonio, rendimento}) do motor de
   rendimento, opcional — enquanto não chega, mostra a soma chapada dos
   aportes (igual ao comportamento anterior) para nunca deixar a tabela
   em branco esperando a rede. */
function renderInvHistory(porMes) {
  const months = [];
  let m = curMonth, y = curYear;
  for (let i = 0; i < 12; i++) {
    months.unshift({ m, y });
    m--; if (m < 0) { m = 11; y--; }
  }

  let acum = 0;
  const rows = months.map(({m, y}) => {
    const { indep, emerg, total } = getInvLancados(m, y);
    acum += total;
    const real = porMes && porMes.get(`${y}-${m+1}`);
    return {
      label: `${MONTHS[m].slice(0,3)}/${y}`, indep, emerg, total,
      rendimento: real ? real.rendimento : null,
      patrimonio: real ? real.patrimonio : acum,
    };
  }).filter(r => r.total > 0);

  const tbody = document.getElementById('inv-history-body');
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:1rem;font-size:12px">Lance valores nas categorias Independência Financeira e Reserva de Emergência na calculadora para ver o histórico aqui.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.label}</td>
      <td class="num">${fmt(r.indep)}</td>
      <td class="num">${fmt(r.emerg)}</td>
      <td class="num">${fmt(r.total)}</td>
      <td class="num ${r.rendimento === null ? '' : 'green'}">${r.rendimento === null ? '—' : fmt(r.rendimento)}</td>
      <td class="num green">${fmt(r.patrimonio)}</td>
    </tr>`).join('');
}

/* porClasseReal: Map(classKey -> saldoFechamento), do motor de rendimento —
   quando presente, mostra o patrimônio REAL de cada classe (com juros).
   Sem ele (ainda calculando, ou offline), cai no rateio teórico chapado —
   nunca deixa o card vazio esperando a rede. */
function renderInvSaldoClasses(classes, acumTotal, porClasseReal) {
  if (!porClasseReal && acumTotal === null) {
    acumTotal = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('fin_20') || k.startsWith('fin_19')) {
        const l = getInvLancadosFromRaw(JSON.parse(localStorage.getItem(k)));
        acumTotal += l.indep;
      }
    }
  }

  // Sem dado real ainda: rateia pela soma das % (não por 100 fixo), pra
  // bater com o que é gravado no banco mesmo se as % não somarem 100%.
  const somaPct = classes.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0);
  const container = document.getElementById('inv-saldo-classes');
  container.innerHTML = classes.map(cls => {
    const pct2 = parseFloat(cls.pct) || 0;
    const val = porClasseReal ? (porClasseReal.get(cls.key) || 0)
      : (somaPct > 0 ? acumTotal * pct2 / somaPct : 0);
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid var(--border)">
      <span style="width:7px;height:7px;border-radius:50%;background:${cls.color};flex-shrink:0"></span>
      <span style="font-size:12px;color:var(--text2);flex:1">${esc(cls.label)}</span>
      <span style="font-size:12px;font-weight:500">${fmt(val)}</span>
      <span style="font-size:10px;color:var(--text3);min-width:28px;text-align:right">${pct2}%</span>
    </div>`;
  }).join('');

  const totalExibido = porClasseReal
    ? [...porClasseReal.values()].reduce((s, v) => s + v, 0)
    : acumTotal;
  document.getElementById('inv-total-acum').textContent = fmt(totalExibido);
}

/* ── Init ── */
const _now = new Date();
curMonth = _now.getMonth();
curYear  = _now.getFullYear();
/* Espera a sincronização com a nuvem (store.js) antes do primeiro render,
   para exibir os dados baixados. Se o store não existir, renderiza direto. */
(window.store ? window.store.ready : Promise.resolve()).then(() => {
  document.getElementById('prev-month').disabled = false;
  document.getElementById('next-month').disabled = false;
  renderCalc();
});
/* ══ SAÚDE FINANCEIRA (Fase D) ══ */
/* Varre todo o histórico local e agrupa cada parcelamento (categoria +
   nome normalizado) pela ocorrência mais RECENTE — é ali que mora o estado
   de verdade da série (quantas parcelas já foram, quantas faltam). Uma
   série some da lista assim que quita (para de ser carregada — Fase A),
   então "ainda aparece aqui com atual<total" já É a definição de "em
   aberto"; não precisa de nenhum estado adicional pra rastrear isso. */
function calcularSaudeFinanceira() {
  const series = new Map(); // "catKey|nome" -> { nome, item, y, m }
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const info = key.match(/^fin_(\d{4})-(\d{2})$/);
    if (!info) continue;
    const y = +info[1], m = +info[2];
    let md;
    try { md = JSON.parse(localStorage.getItem(key)); } catch { continue; }
    (md.cats || []).forEach(cat => {
      if (!CATS_COM_PARCELA.has(cat.key)) return;
      (cat.items || []).forEach(it => {
        if (!it.parcela || !(it.parcela.total > 0)) return;
        const chave = cat.key + '|' + recNorm(it.name);
        const atual = series.get(chave);
        if (!atual || y > atual.y || (y === atual.y && m > atual.m)) {
          series.set(chave, { nome: it.name, item: it, y, m });
        }
      });
    });
  }

  const ativos = [];
  let dividaTotal = 0;
  series.forEach(({ nome, item }) => {
    const parcAtual = Number(item.parcela.atual) || 1;
    const parcTotal = Number(item.parcela.total) || 1;
    if (parcAtual >= parcTotal) return; // quitada, não conta mais
    const valorParcela = parseFloat(item.value) || 0;
    const valorRestante = valorParcela * (parcTotal - parcAtual + 1);
    dividaTotal += valorRestante;
    ativos.push({ nome, atual: parcAtual, total: parcTotal, valorRestante });
  });
  ativos.sort((a, b) => b.valorRestante - a.valorRestante);

  return { dividaTotal, ativos, quitado: ativos.length === 0 };
}

function renderSaudeFinanceira() {
  const container = document.getElementById('saude-financeira-body');
  if (!container) return;
  const saude = calcularSaudeFinanceira();

  let perfil = null;
  try { perfil = JSON.parse(localStorage.getItem('fin_perfil') || 'null'); } catch { /* ignora */ }
  const eraSaindoDoVermelho = perfil && perfil.perfilKey === 'saindo_do_vermelho';

  if (saude.quitado) {
    container.innerHTML = `
      <div class="saude-ok">Nenhuma dívida parcelada em aberto no momento.</div>
      ${eraSaindoDoVermelho ? `
        <div class="perfil-resultado" style="margin-top:0.75rem">
          <div class="perfil-resultado-titulo">Parece que você quitou suas dívidas parceladas!</div>
          <p style="font-size:12px;color:var(--text2)">Seu perfil ainda está marcado como "Saindo do Vermelho" — refaça a pergunta sobre dívida no questionário abaixo pra atualizar suas categorias.</p>
          <button class="btn btn-primary" id="btn-atualizar-perfil-sem-divida">Refazer com "sem dívida"</button>
        </div>
      ` : ''}
    `;
    const btn = document.getElementById('btn-atualizar-perfil-sem-divida');
    if (btn) btn.addEventListener('click', () => {
      const semDivida = document.querySelector('input[name="q-temDivida"][value="false"]');
      if (semDivida) {
        semDivida.checked = true;
        semDivida.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.getElementById('btn-calcular-perfil')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return;
  }

  container.innerHTML = `
    <div class="saude-divida-total">
      <span>Total em dívida (parcelas em aberto)</span>
      <span class="pct">${fmt(saude.dividaTotal)}</span>
    </div>
    ${saude.ativos.map(a => `
      <div class="perfil-resultado-cat-row">
        <span class="nome">${esc(a.nome)} <span class="item-parcela-badge">${a.atual}/${a.total}</span></span>
        <span class="pct">${fmt(a.valorRestante)}</span>
      </div>
    `).join('')}
  `;
}

/* ══ PERFIL ══ */
async function renderProfile() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return;

  const name  = user.user_metadata?.full_name || '';
  const email = user.email || '';
  const initial = name ? name.charAt(0).toUpperCase() : email.charAt(0).toUpperCase();

  // Avatar e info no sidebar e na página
  document.getElementById('profile-avatar-display').textContent = initial;
  document.getElementById('sidebar-username').textContent = name || 'Perfil';
  document.getElementById('profile-name-display').textContent = name || '—';
  document.getElementById('profile-email-display').textContent = email;

  // Preenche os campos
  document.getElementById('profile-name').value  = name;
  document.getElementById('profile-email').value = email;
}

function showProfileMsg(id, type, text) {
  const el = document.getElementById(id);
  el.className = 'profile-msg ' + type;
  el.textContent = text;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// Salvar dados pessoais
document.getElementById('btn-save-profile').addEventListener('click', async () => {
  const name  = document.getElementById('profile-name').value.trim();
  const email = document.getElementById('profile-email').value.trim();

  if (!name || !email) {
    showProfileMsg('profile-msg', 'error', 'Preencha todos os campos.');
    return;
  }

  const btn = document.getElementById('btn-save-profile');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const { error } = await db.auth.updateUser({
    email,
    data: { full_name: name }
  });

  btn.disabled = false;
  btn.textContent = 'Salvar alterações';

  if (error) {
    showProfileMsg('profile-msg', 'error', 'Erro ao salvar: ' + error.message);
    return;
  }

  showProfileMsg('profile-msg', 'success', 'Dados atualizados com sucesso!');
  renderProfile();
});

// Alterar senha
document.getElementById('btn-save-password').addEventListener('click', async () => {
  const newPass     = document.getElementById('profile-new-password').value;
  const confirmPass = document.getElementById('profile-confirm-password').value;

  if (!newPass || !confirmPass) {
    showProfileMsg('password-msg', 'error', 'Preencha os dois campos.');
    return;
  }
  if (newPass.length < 6) {
    showProfileMsg('password-msg', 'error', 'A senha deve ter pelo menos 6 caracteres.');
    return;
  }
  if (newPass !== confirmPass) {
    showProfileMsg('password-msg', 'error', 'As senhas não coincidem.');
    return;
  }

  const btn = document.getElementById('btn-save-password');
  btn.disabled = true;
  btn.textContent = 'Alterando...';

  const { error } = await db.auth.updateUser({ password: newPass });

  btn.disabled = false;
  btn.textContent = 'Alterar senha';

  if (error) {
    showProfileMsg('password-msg', 'error', 'Erro: ' + error.message);
    return;
  }

  showProfileMsg('password-msg', 'success', 'Senha alterada com sucesso!');
  document.getElementById('profile-new-password').value = '';
  document.getElementById('profile-confirm-password').value = '';
});

/* ── Perfil financeiro (questionário, Fase B2) ── */
const PERFIL_CATS_LABEL = {
  independencia: 'Independência Financeira', fixos: 'Custos Fixos', variaveis: 'Custos Variáveis',
  conforto: 'Conforto', emergencia: 'Reserva de Emergência', meta: 'Meta de Curto/Médio Prazo',
};
const PERFIL_CATS_ORDEM = ['independencia', 'fixos', 'variaveis', 'conforto', 'emergencia', 'meta'];
const PERFIL_MIX_LABEL = { renda_fixa: 'Renda Fixa', acoes: 'Ações', fii: 'FII', exterior: 'Internacional' };
const PERFIL_MIX_ORDEM = ['renda_fixa', 'acoes', 'fii', 'exterior'];

function pctPadrao(key) {
  const raw = localStorage.getItem('fin_perfil');
  if (raw) {
    try {
      const perfil = JSON.parse(raw);
      const v = perfil.cats_pct && perfil.cats_pct[key];
      if (typeof v === 'number') return v;
    } catch { /* ignora perfil corrompido, cai no padrão */ }
  }
  const def = CATS.find(c => c.key === key);
  return def ? def.pct : 0;
}

function atualizarVisibilidadeHorizonte() {
  const objetivo = document.querySelector('input[name="q-objetivo"]:checked')?.value;
  document.getElementById('perfil-q-horizonte').style.display = objetivo === 'meta' ? 'flex' : 'none';
}
document.querySelectorAll('input[name="q-objetivo"]').forEach(inp => {
  inp.addEventListener('change', atualizarVisibilidadeHorizonte);
});

function lerRespostasPerfilForm() {
  const val = (name) => document.querySelector(`input[name="q-${name}"]:checked`)?.value;
  const bool = (v) => (v === 'true' ? true : (v === 'false' ? false : undefined));
  return {
    rendaFixa: bool(val('rendaFixa')),
    dependentes: val('dependentes') ? parseInt(val('dependentes')) : undefined,
    temDivida: bool(val('temDivida')),
    reserva: val('reserva'),
    objetivo: val('objetivo'),
    metaHorizonte: val('metaHorizonte'),
    risco: val('risco'),
  };
}

/* Marca de volta as respostas salvas (se já respondeu antes) e ajusta a
   pergunta condicional de horizonte — chamada toda vez que a aba de Perfil
   é aberta, já que fin_perfil pode ter chegado da nuvem depois do login. */
function initPerfilForm() {
  const raw = localStorage.getItem('fin_perfil');
  if (raw) {
    let perfil;
    try { perfil = JSON.parse(raw); } catch { perfil = null; }
    const respostas = perfil && perfil.respostas || {};
    const marcar = (name, value) => {
      if (value === undefined || value === null) return;
      const el = document.querySelector(`input[name="q-${name}"][value="${value}"]`);
      if (el) el.checked = true;
    };
    marcar('rendaFixa', respostas.rendaFixa);
    marcar('dependentes', respostas.dependentes);
    marcar('temDivida', respostas.temDivida);
    marcar('reserva', respostas.reserva);
    marcar('objetivo', respostas.objetivo);
    marcar('metaHorizonte', respostas.metaHorizonte);
    marcar('risco', respostas.risco);
  }
  atualizarVisibilidadeHorizonte();
}

function renderPerfilResultado(resultado) {
  const el = document.getElementById('perfil-resultado');
  el.className = 'perfil-resultado';
  el.innerHTML = `
    <div class="perfil-resultado-titulo">Seu perfil: <strong>${resultado.perfilLabel}</strong></div>
    <div class="perfil-resultado-cats">
      ${PERFIL_CATS_ORDEM.map(k => `
        <div class="perfil-resultado-cat-row">
          <span class="nome">${PERFIL_CATS_LABEL[k]}</span>
          <span class="pct">${resultado.catsPct[k]}%</span>
        </div>
      `).join('')}
    </div>
    <div class="perfil-resultado-reserva">Meta de reserva sugerida: ${resultado.mesesReserva} meses de Custos Fixos.</div>
    <div class="perfil-resultado-subtitulo">Mix de investimento sugerido (Renda Fixa/Ações/FII/Internacional)</div>
    <div class="perfil-resultado-cats">
      ${PERFIL_MIX_ORDEM.map(k => `
        <div class="perfil-resultado-cat-row">
          <span class="nome">${PERFIL_MIX_LABEL[k]}</span>
          <span class="pct">${resultado.mixInvestimento[k]}%</span>
        </div>
      `).join('')}
    </div>
    <button class="btn btn-primary" id="btn-aplicar-perfil">Aplicar esse perfil</button>
  `;
  document.getElementById('btn-aplicar-perfil').addEventListener('click', () => aplicarPerfil(resultado));
}

function aplicarPerfil(resultado) {
  localStorage.setItem('fin_perfil', JSON.stringify({
    perfilKey: resultado.perfilKey,
    cats_pct: resultado.catsPct,
    risco: resultado.risco,
    respostas: resultado.respostas,
  }));
  // Fase B3 + C: aplica o mix de investimento (horizonte x risco) só nas
  // classes conhecidas (renda_fixa/ações/fii/exterior) — uma classe extra
  // que o usuário tenha criado além dessas 4 não é tocada. O mix vai pra
  // carteira certa: perfil "Meta de Curto/Médio Prazo" usa o horizonte que
  // a pessoa respondeu (curto/médio) e esse dinheiro tem destino próprio
  // (a carteira da Meta, mais conservadora) — não faz sentido aplicar esse
  // mesmo mix na carteira de Independência, que é sempre de longo prazo.
  // invest_classes não tem histórico por mês (isso é o invest_ledger, nunca
  // mexido aqui), então não existe o mesmo risco de reescrever um mês
  // passado que existe em cats_pct.
  const ehPerfilMeta = resultado.perfilKey === 'objetivo_meta';
  const todasClasses = ehPerfilMeta ? loadInvClassesMeta() : loadInvClasses();
  let mudouClasses = false;
  todasClasses.forEach((c) => {
    const novoPct = resultado.mixInvestimento[c.key];
    if (typeof novoPct === 'number' && c.pct !== novoPct) {
      c.pct = novoPct;
      mudouClasses = true;
    }
  });
  if (mudouClasses) {
    if (ehPerfilMeta) saveInvClassesMeta(todasClasses);
    else saveInvClasses(todasClasses);
  }
  // Aplica no mês REAL de hoje (new Date(), nunca curMonth/curYear) — a
  // Perfil pode ser aberta com a Calculadora deixada em qualquer mês
  // passado, e mexer nesse cursor reescreveria um mês já salvo por causa
  // de uma ação que não tinha nada a ver com ele (exatamente o tipo de
  // corrida que a Fase 3b existe pra evitar). Meses futuros novos já
  // nascem com o perfil via pctPadrao(); meses passados nunca são tocados.
  const hoje = new Date();
  const mHoje = hoje.getMonth(), yHoje = hoje.getFullYear();
  if (localStorage.getItem('fin_' + mKey(mHoje, yHoje))) {
    const md = loadMonth(mHoje, yHoje);
    md.cats.forEach(c => {
      if (typeof resultado.catsPct[c.key] === 'number') c.pct = resultado.catsPct[c.key];
    });
    saveMonth(mHoje, yHoje, md);
    if (curMonth === mHoje && curYear === yHoje) renderCalc();
  }
  showProfileMsg('perfil-msg', 'success', 'Perfil aplicado! A partir de hoje, os meses e o mix de investimento vão usar essas porcentagens.');
}

document.getElementById('btn-calcular-perfil').addEventListener('click', () => {
  const respostas = lerRespostasPerfilForm();
  const obrigatorios = ['rendaFixa', 'dependentes', 'temDivida', 'reserva', 'objetivo', 'risco'];
  if (respostas.objetivo === 'meta') obrigatorios.push('metaHorizonte');
  const faltando = obrigatorios.some(k => respostas[k] === undefined || respostas[k] === null || respostas[k] === '');
  if (faltando) {
    showProfileMsg('perfil-msg', 'error', 'Responda todas as perguntas antes de calcular.');
    return;
  }
  const resultado = calcularPerfilCompleto(respostas);
  renderPerfilResultado(resultado);
});

// Logout com confirmação
document.getElementById('btn-logout').addEventListener('click', () => {
  document.getElementById('confirm-overlay').classList.add('open');
});
document.getElementById('confirm-cancel').addEventListener('click', () => {
  document.getElementById('confirm-overlay').classList.remove('open');
});
document.getElementById('confirm-logout').addEventListener('click', async () => {
  window._logoutIntencional = true; // ver aviso de sessão expirada no store.js
  await db.auth.signOut();
  window.location.href = 'index.html';
});

// Carrega perfil ao abrir a aba
const _navItems = document.querySelectorAll('.nav-item');
_navItems.forEach(el => {
  el.addEventListener('click', () => {
    if (el.dataset.page === 'profile') { renderProfile(); initPerfilForm(); renderSaudeFinanceira(); }
  });
});

// Carrega inicial do avatar no sidebar ao iniciar
db.auth.getUser().then(({ data: { user } }) => {
  if (!user) return;
  const name = user.user_metadata?.full_name || user.email || '';
  const initial = name.charAt(0).toUpperCase();
  document.getElementById('profile-avatar-display').textContent = initial;
  document.getElementById('sidebar-username').textContent = user.user_metadata?.full_name || 'Perfil';
});
