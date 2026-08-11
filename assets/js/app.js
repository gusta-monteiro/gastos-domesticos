const CATS = [
  { key: 'independencia', label: 'Independência Financeira', pct: 10, color: '#1a1a18' },
  { key: 'fixos',         label: 'Custos Fixos',             pct: 55, color: '#5f5e5a' },
  { key: 'variaveis',     label: 'Custos Variáveis',         pct: 20, color: '#888780' },
  { key: 'conforto',      label: 'Conforto',                 pct: 10, color: '#b4b2a9' },
  { key: 'emergencia',    label: 'Reserva de Emergência',    pct:  5, color: '#d3d1c7' },
];
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
    : { renda: '', rendas: [], cats: CATS.map(c => ({ key: c.key, pct: c.pct, items: [] })) };
  // migração: meses antigos tinham só o número "renda"; viram uma entrada única
  if (!Array.isArray(d.rendas)) {
    d.rendas = (parseFloat(d.renda) > 0) ? [{ name: 'Renda', value: String(d.renda) }] : [];
  }
  return d;
}
function totalRendas(md) {
  return (md.rendas || []).reduce((s, r) => s + (parseFloat(r.value) || 0), 0);
}
function saveMonth(m, y, d) { localStorage.setItem('fin_' + mKey(m, y), JSON.stringify(d)); }
function getApiKey() { return localStorage.getItem('fin_api_key') || ''; }
function setApiKey(k) { localStorage.setItem('fin_api_key', k); }

/* ── Formatting ── */
function fmt(v) {
  const n = parseFloat(v) || 0;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }
/* Escapa texto do usuário antes de entrar em innerHTML/atributos */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── Navigation ── */
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
  });
});

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
        <input class="item-val" type="number" placeholder="0" min="0" value="${esc(r.value)}" data-i="${i}">
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
    inp.addEventListener('input', e => {
      md.rendas[parseInt(e.target.dataset.i)].value = e.target.value;
      persistir();
      atualizarValores();
    });
  });
  container.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      md.rendas.splice(parseInt(btn.dataset.i), 1);
      persistir();
      renderCalc();
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
        ${cat.items.map((it, ii) => `
          <div class="item-row">
            <input class="item-name" type="text" placeholder="Descrição" value="${esc(it.name)}" data-ci="${ci}" data-ii="${ii}">
            <input class="item-val" type="number" placeholder="0" min="0" value="${it.value||''}" data-ci="${ci}" data-ii="${ii}">
            <button class="del-btn" data-ci="${ci}" data-ii="${ii}"><i class="ti ti-x"></i></button>
          </div>
        `).join('')}
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
      inp.addEventListener('input', e => {
        md.cats[parseInt(e.target.dataset.ci)].items[parseInt(e.target.dataset.ii)].value = e.target.value;
        saveMonth(curMonth, curYear, md);
        renderPie(md, parseFloat(md.renda)||0);
        renderMetrics(md, parseFloat(md.renda)||0);
      });
    });
    div.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        md.cats[parseInt(btn.dataset.ci)].items.splice(parseInt(btn.dataset.ii), 1);
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
  html += `<table class="report-table">
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
  html += `</tbody></table>`;

  /* Detalhamento por categoria */
  html += `<br><div class="report-section-title">Gastos por categoria</div>`;
  html += `<table class="report-table"><thead><tr><th>Categoria</th>${data.map(d => `<th class="num">${d.label}</th>`).join('')}</tr></thead><tbody>`;
  CATS.forEach((def, ci) => {
    html += `<tr><td>${def.label}</td>`;
    data.forEach(({md}) => {
      const v = md.cats[ci] ? md.cats[ci].items.reduce((s, it) => s + (parseFloat(it.value)||0), 0) : 0;
      html += `<td class="num">${fmt(v)}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;

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

/* Pega os valores LANÇADOS nos itens de independencia e emergencia do mês */
function getInvLancados(m, y) {
  const md = loadMonth(m, y);
  const catIndep = md.cats.find(c => c.key === 'independencia');
  const catEmerg = md.cats.find(c => c.key === 'emergencia');
  const indep = catIndep ? catIndep.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0) : 0;
  const emerg = catEmerg ? catEmerg.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0) : 0;
  return { indep, emerg, total: indep + emerg };
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
async function carregarEvolucaoInvestimentos() {
  if (!window.store || !window.store.buscarLedgerCompleto) return null;
  const { classes, ledger } = await window.store.buscarLedgerCompleto();
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
  const { indep, emerg, total } = getInvLancados(curMonth, curYear);

  document.getElementById('inv-month-lbl').textContent = `${MONTHS[curMonth]} ${curYear}`;

  /* Acumulado histórico: soma real de todos os meses, já separado por destino
     — Independência alimenta as classes de investimento, Emergência é caixa. */
  let acumIndep = 0, acumEmerg = 0;
  const allKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('fin_20') || k.startsWith('fin_19')) allKeys.push(k);
  }
  allKeys.forEach(k => {
    const l = getInvLancadosFromRaw(JSON.parse(localStorage.getItem(k)));
    acumIndep += l.indep;
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
    .then(() => carregarEvolucaoInvestimentos())
    .then(dados => {
      if (meuSeq !== invRenderSeq) return;
      aplicarPatrimonioReal(dados, todasClasses, classes, reserva, acumEmerg);
    })
    .catch(err => console.error('[invest] erro ao calcular patrimônio real', err));
}

function getInvLancadosFromRaw(md) {
  const catIndep = md.cats.find(c => c.key === 'independencia');
  const catEmerg = md.cats.find(c => c.key === 'emergencia');
  const indep = catIndep ? catIndep.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0) : 0;
  const emerg = catEmerg ? catEmerg.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0) : 0;
  return { indep, emerg, total: indep + emerg };
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
   pequeno retorno visual — reaproveitado pelas classes e pela reserva. */
function ligarSaldoReal(container, classKey) {
  const input = container.querySelector('.inv-saldo-real-input');
  const msg = container.querySelector('.inv-saldo-real-msg');
  input.addEventListener('change', async e => {
    const valor = parseFloat(e.target.value);
    if (!(valor >= 0)) { msg.textContent = ''; return; }
    msg.textContent = 'Salvando...';
    msg.className = 'inv-saldo-real-msg';
    try {
      await window.store.salvarSaldoReal(classKey, valor);
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
    const aaPct = ((parseFloat(cls.aa)||0) * 100).toFixed(2);
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
        <label>Taxa esperada<input class="inv-aa-input" type="number" step="0.1" value="${aaPct}"> % a.a.</label>
        <label>Saldo real<input class="inv-saldo-real-input" type="number" min="0" step="0.01" placeholder="Opcional"></label>
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
      cls.aa = (parseFloat(e.target.value) || 0) / 100;
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
    });
    ligarSaldoReal(div, cls.key);
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

/* Reserva de Emergência: card separado, sem % de rateio — recebe 100% do
   que for lançado em "emergencia" e tem sua própria taxa esperada. */
function renderReserva(todasClasses, aporteMes, acumEmerg, saldoReal) {
  const container = document.getElementById('inv-reserva');
  if (!container) return;
  const reserva = classeReserva(todasClasses);
  if (!reserva) { container.innerHTML = ''; return; }
  const aaPct = ((parseFloat(reserva.aa)||0) * 100).toFixed(2);
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
      <label>Taxa esperada<input class="inv-aa-input" type="number" step="0.1" value="${aaPct}"> % a.a.</label>
      <label>Saldo real<input class="inv-saldo-real-input" type="number" min="0" step="0.01" placeholder="Opcional"></label>
      <span class="inv-saldo-real-msg"></span>
    </div>
  `;
  container.querySelector('.inv-aa-input').addEventListener('change', e => {
    reserva.aa = (parseFloat(e.target.value) || 0) / 100;
    saveInvClasses(todasClasses);
  });
  ligarSaldoReal(container, reserva.key);
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
(window.store ? window.store.ready : Promise.resolve()).then(renderCalc);
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

// Logout com confirmação
document.getElementById('btn-logout').addEventListener('click', () => {
  document.getElementById('confirm-overlay').classList.add('open');
});
document.getElementById('confirm-cancel').addEventListener('click', () => {
  document.getElementById('confirm-overlay').classList.remove('open');
});
document.getElementById('confirm-logout').addEventListener('click', async () => {
  await db.auth.signOut();
  window.location.href = 'index.html';
});

// Carrega perfil ao abrir a aba
const _navItems = document.querySelectorAll('.nav-item');
_navItems.forEach(el => {
  el.addEventListener('click', () => {
    if (el.dataset.page === 'profile') renderProfile();
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
