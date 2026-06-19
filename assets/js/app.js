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

/* ── Storage helpers ── */
function mKey(m, y) { return `${y}-${String(m+1).padStart(2,'0')}`; }
function loadMonth(m, y) {
  const raw = localStorage.getItem('fin_' + mKey(m, y));
  if (raw) return JSON.parse(raw);
  return { renda: '', cats: CATS.map(c => ({ key: c.key, pct: c.pct, items: [] })) };
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
document.getElementById('renda').addEventListener('input', e => {
  const md = loadMonth(curMonth, curYear);
  md.renda = e.target.value;
  saveMonth(curMonth, curYear, md);
  renderCalc();
});

/* ══ CALCULADORA ══ */
function renderCalc() {
  const md = loadMonth(curMonth, curYear);
  document.getElementById('month-label').textContent = `${MONTHS[curMonth]} ${curYear}`;
  document.getElementById('renda').value = md.renda;
  const renda = parseFloat(md.renda) || 0;
  renderMetrics(md, renda);
  renderCategories(md, renda);
  renderPie(md, renda);
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
      <div class="metric-card-label">Alocado</div>
      <div class="metric-card-val">${fmt(totalAlocado)}</div>
      <div class="metric-card-sub">${pct(totalAlocado, renda)}% da renda</div>
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
    warn.innerHTML = `<div class="pct-warning">⚠ Porcentagens somam ${totalPct.toFixed(0)}% — acima de 100%</div>`;
  } else { warn.style.display = 'none'; }
  document.getElementById('pct-total-lbl').textContent = `${totalPct.toFixed(0)}% alocados`;

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
        <span class="cat-value">${fmt(alocado)}</span>
        <i class="ti ti-chevron-down cat-toggle ${isOpen ? 'open' : ''}"></i>
      </div>
      <div class="cat-items ${isOpen ? 'open' : ''}">
        ${cat.items.map((it, ii) => `
          <div class="item-row">
            <input class="item-name" type="text" placeholder="Descrição" value="${it.name||''}" data-ci="${ci}" data-ii="${ii}">
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

function renderPie(md, renda) {
  const vals = md.cats.map(c => renda * (parseFloat(c.pct)||0) / 100);
  const colors = CATS.map(c => c.color);
  document.getElementById('chart-center-val').textContent = fmt(renda);

  if (pieChart) {
    pieChart.data.datasets[0].data = vals;
    pieChart.update();
  } else {
    pieChart = new Chart(document.getElementById('pieChart'), {
      type: 'doughnut',
      data: {
        labels: CATS.map(c => c.label),
        datasets: [{ data: vals, backgroundColor: colors, borderColor: 'transparent', borderWidth: 0, hoverOffset: 4 }]
      },
      options: {
        responsive: false, cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${fmt(ctx.raw)} (${pct(ctx.raw, renda)}%)` } }
        }
      }
    });
  }

  document.getElementById('legend').innerHTML = md.cats.map((cat, ci) => {
    const def = CATS[ci];
    const p = parseFloat(cat.pct)||0;
    const v = renda * p / 100;
    return `<div class="leg-row">
      <span class="leg-dot" style="background:${def.color}"></span>
      <span class="leg-name">${def.label}</span>
      <span class="leg-val">${fmt(v)}</span>
      <span class="leg-pct">${p}%</span>
    </div>`;
  }).join('');
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
        { label: 'Renda', data: rendas, backgroundColor: '#2C2C2A' },
        { label: 'Gastos', data: gastos, backgroundColor: '#B4B2A9' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { family: 'Inter', size: 11 }, autoSkip: false }, grid: { display: false } },
        y: { ticks: { font: { family: 'Inter', size: 11 }, callback: v => 'R$' + (v/1000).toFixed(0) + 'k' }, grid: { color: 'rgba(0,0,0,0.05)' } }
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
  }));

  if (stackChart) stackChart.destroy();
  stackChart = new Chart(document.getElementById('stackChart'), {
    type: 'bar',
    data: { labels, datasets: catDatasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { stacked: true, ticks: { font: { family: 'Inter', size: 11 }, autoSkip: false }, grid: { display: false } },
        y: { stacked: true, ticks: { font: { family: 'Inter', size: 11 }, callback: v => 'R$' + (v/1000).toFixed(0) + 'k' }, grid: { color: 'rgba(0,0,0,0.05)' } }
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
  { key: 'renda_fixa', label: 'Renda Fixa',    pct: 40, color: '#1a1a18' },
  { key: 'acoes',      label: 'Ações',          pct: 30, color: '#5f5e5a' },
  { key: 'fii',        label: 'FII',            pct: 20, color: '#888780' },
  { key: 'exterior',   label: 'Internacional',  pct: 10, color: '#b4b2a9' },
];

let invPieChart = null;

function loadInvClasses() {
  const raw = localStorage.getItem('fin_inv_classes');
  return raw ? JSON.parse(raw) : INV_CLASSES_DEFAULT.map(c => ({ ...c }));
}
function saveInvClasses(cls) { localStorage.setItem('fin_inv_classes', JSON.stringify(cls)); }

/* Pega os valores LANÇADOS nos itens de independencia e emergencia do mês */
function getInvLancados(m, y) {
  const md = loadMonth(m, y);
  const catIndep = md.cats.find(c => c.key === 'independencia');
  const catEmerg = md.cats.find(c => c.key === 'emergencia');
  const indep = catIndep ? catIndep.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0) : 0;
  const emerg = catEmerg ? catEmerg.items.reduce((s, it) => s + (parseFloat(it.value)||0), 0) : 0;
  return { indep, emerg, total: indep + emerg };
}

function renderInvest() {
  const classes = loadInvClasses();
  const { indep, emerg, total } = getInvLancados(curMonth, curYear);

  document.getElementById('inv-month-lbl').textContent = `${MONTHS[curMonth]} ${curYear}`;

  /* Acumulado histórico: soma real de todos os meses */
  let acumTotal = 0;
  const allKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('fin_20') || k.startsWith('fin_19')) allKeys.push(k);
  }
  allKeys.forEach(k => {
    const l = getInvLancadosFromRaw(JSON.parse(localStorage.getItem(k)));
    acumTotal += l.total;
  });

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
      <div class="metric-card-label">Acumulado total</div>
      <div class="metric-card-val green">${fmt(acumTotal)}</div>
      <div class="metric-card-sub">Todos os meses</div>
    </div>
  `;

  renderInvAporteRows(indep, emerg, total);
  renderInvClasses(classes, total);
  renderInvPie(classes, total);
  renderInvHistory();
  renderInvSaldoClasses(classes, acumTotal);
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
            <span style="color:var(--text2)">${it.name || '—'}</span>
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

function renderInvClasses(classes, aporte) {
  const totalPct = classes.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0);
  const warn = document.getElementById('inv-pct-warning');
  if (totalPct > 100.01) {
    warn.style.display = 'block';
    warn.innerHTML = `<div class="pct-warning">⚠ Porcentagens somam ${totalPct.toFixed(0)}% — acima de 100%</div>`;
  } else { warn.style.display = 'none'; }
  document.getElementById('inv-pct-lbl').textContent = `${totalPct.toFixed(0)}% alocados`;

  const container = document.getElementById('inv-classes');
  container.innerHTML = '';
  classes.forEach((cls, ci) => {
    const val = aporte * (parseFloat(cls.pct)||0) / 100;
    const div = document.createElement('div');
    div.className = 'category';
    div.innerHTML = `
      <div class="cat-header" style="cursor:default">
        <span class="cat-dot" style="background:${cls.color}"></span>
        <input class="item-name" type="text" value="${cls.label}" data-ci="${ci}" placeholder="Classe" style="font-size:12px;font-weight:500;max-width:150px">
        <div class="cat-pct-wrap" style="margin-left:auto">
          <input class="cat-pct-input" type="number" min="0" max="100" step="1" value="${cls.pct}" data-ci="${ci}">
          <span class="cat-pct-sym">%</span>
        </div>
        <span class="cat-value">${fmt(val)}</span>
        <button class="del-btn" data-ci="${ci}" title="Remover"><i class="ti ti-x"></i></button>
      </div>
    `;
    div.querySelector('.item-name').addEventListener('input', e => {
      classes[parseInt(e.target.dataset.ci)].label = e.target.value;
      saveInvClasses(classes);
      renderInvPie(classes, aporte);
      renderInvSaldoClasses(classes, null);
    });
    div.querySelector('.cat-pct-input').addEventListener('change', e => {
      classes[parseInt(e.target.dataset.ci)].pct = parseFloat(e.target.value) || 0;
      saveInvClasses(classes);
      renderInvest();
    });
    div.querySelector('.del-btn').addEventListener('click', () => {
      classes.splice(ci, 1);
      saveInvClasses(classes);
      renderInvest();
    });
    container.appendChild(div);
  });

  const addWrap = document.createElement('div');
  addWrap.style.cssText = 'padding:0.6rem 1.25rem;border-top:0.5px solid var(--border)';
  addWrap.innerHTML = `<button class="add-item-btn" id="inv-add-class"><i class="ti ti-plus"></i> Adicionar classe</button>`;
  container.appendChild(addWrap);
  document.getElementById('inv-add-class').addEventListener('click', () => {
    const palette = ['#2C2C2A','#5f5e5a','#888780','#b4b2a9','#d3d1c7','#444441'];
    classes.push({ key: 'cls_' + Date.now(), label: 'Nova classe', pct: 0, color: palette[classes.length % palette.length] });
    saveInvClasses(classes);
    renderInvest();
  });
}

function renderInvPie(classes, aporte) {
  const vals = classes.map(c => aporte * (parseFloat(c.pct)||0) / 100);
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
        datasets: [{ data: vals, backgroundColor: colors, borderColor: 'transparent', borderWidth: 0, hoverOffset: 4 }]
      },
      options: {
        responsive: false, cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${fmt(ctx.raw)} (${aporte > 0 ? Math.round(ctx.raw/aporte*100) : 0}%)` } }
        }
      }
    });
  }

  document.getElementById('inv-legend').innerHTML = classes.map((cls, ci) => `
    <div class="leg-row">
      <span class="leg-dot" style="background:${cls.color}"></span>
      <span class="leg-name">${cls.label}</span>
      <span class="leg-val">${fmt(vals[ci])}</span>
      <span class="leg-pct">${parseFloat(cls.pct)||0}%</span>
    </div>`).join('');
}

function renderInvHistory() {
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
    return { label: `${MONTHS[m].slice(0,3)}/${y}`, indep, emerg, total, acum };
  }).filter(r => r.total > 0);

  const tbody = document.getElementById('inv-history-body');
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:1rem;font-size:12px">Lance valores nas categorias Independência Financeira e Reserva de Emergência na calculadora para ver o histórico aqui.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.label}</td>
      <td class="num">${fmt(r.indep)}</td>
      <td class="num">${fmt(r.emerg)}</td>
      <td class="num">${fmt(r.total)}</td>
      <td class="num green">${fmt(r.acum)}</td>
    </tr>`).join('');
}

function renderInvSaldoClasses(classes, acumTotal) {
  /* Se acumTotal não foi passado, recalcula */
  if (acumTotal === null) {
    acumTotal = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('fin_20') || k.startsWith('fin_19')) {
        const l = getInvLancadosFromRaw(JSON.parse(localStorage.getItem(k)));
        acumTotal += l.total;
      }
    }
  }

  const container = document.getElementById('inv-saldo-classes');
  container.innerHTML = classes.map(cls => {
    const pct2 = parseFloat(cls.pct) || 0;
    const val = acumTotal * pct2 / 100;
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid var(--border)">
      <span style="width:7px;height:7px;border-radius:50%;background:${cls.color};flex-shrink:0"></span>
      <span style="font-size:12px;color:var(--text2);flex:1">${cls.label}</span>
      <span style="font-size:12px;font-weight:500">${fmt(val)}</span>
      <span style="font-size:10px;color:var(--text3);min-width:28px;text-align:right">${pct2}%</span>
    </div>`;
  }).join('');

  document.getElementById('inv-total-acum').textContent = fmt(acumTotal);
}

/* ── Init ── */
const _now = new Date();
curMonth = _now.getMonth();
curYear  = _now.getFullYear();
renderCalc();