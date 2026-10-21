// Pestaña Dashboard: gastado vs presupuestado, cuentas, personas, categorías, días y lugares.
import { state, todayISO, GENERAL, findPerson } from '../store.js';
import { esc, money, pct, emptyState, openSheet, fmtDay, daysBetween, addDays, animateIn } from '../ui.js';
import { alive, sum, groupSum, budgetSummary, isDaily } from '../calc.js';
import { expenseRow, editExpense } from './register.js';

export const title = 'Dashboard';

const f = { person: 'all', place: 'all', period: 'all', catScope: 'general' };
try { Object.assign(f, JSON.parse(sessionStorage.getItem('dash.f') || '{}')); } catch {}
const persist = () => sessionStorage.setItem('dash.f', JSON.stringify(f));

let root;

function filtered() {
  const today = todayISO();
  return alive().filter((e) => {
    if (f.person !== 'all' && (e.personId || GENERAL) !== f.person) return false;
    if (f.place !== 'all' && (e.placeId || '') !== f.place) return false;
    if (f.period === 'today' && e.date !== today) return false;
    if (f.period === '7d' && e.date < addDays(today, -6)) return false;
    return true;
  });
}

function barRow({ label, spent, budget, color, max, sub = '' }) {
  const hasBudget = budget > 0;
  const ratio = hasBudget ? spent / budget : max > 0 ? spent / max : 0;
  const over = hasBudget && spent > budget;
  return `
    <div class="bar-row">
      <div class="bar-top">
        <span class="bar-label">${label}</span>
        <span class="bar-val"><b>${money(spent)}</b>${hasBudget ? `<span class="muted"> / ${money(budget)}</span>` : ''}</span>
      </div>
      <div class="bar"><i class="${over ? 'over' : ''}" style="width:${Math.min(100, ratio * 100)}%;${color ? `background:${color}` : ''}"></i></div>
      ${hasBudget
        ? `<div class="bar-foot"><span class="pc ${over ? 'bad' : 'good'}">${over ? 'Excedido' : 'Quedan'} ${money(Math.abs(budget - spent))}</span>${pct(ratio)}${sub}</div>`
        : sub ? `<div class="bar-foot">${sub}</div>` : ''}
    </div>`;
}

function ring(ratio) {
  const r = 52, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, ratio));
  const over = ratio > 1;
  return `
    <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="${r}" class="ring-bg"/>
      <circle cx="60" cy="60" r="${r}" class="ring-fg ${over ? 'over' : ratio > 0.85 ? 'warn' : ''}" style="--c0:${c}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v)}" transform="rotate(-90 60 60)"/>
      <text x="60" y="58" class="ring-pct">${Math.round(ratio * 100)}%</text>
      <text x="60" y="76" class="ring-sub">gastado</text>
    </svg>`;
}

export function render(el, anim = 'enter') {
  root = el;
  const all = alive();
  if (!all.length) {
    el.innerHTML = emptyState('Cuando registren gastos, aquí verán cuánto llevan gastado contra el presupuesto, por persona, categoría, lugar y cuenta.', '📊') +
      '<a class="btn primary block" href="#registro">Registrar el primer gasto</a>';
    animateIn(el, anim);
    return;
  }
  const exps = filtered();
  const b = budgetSummary();
  const today = todayISO();

  // Presupuesto de referencia según el filtro de persona.
  let budget = b.total, scopeLabel = 'Presupuesto total';
  if (f.person === GENERAL) { budget = b.general; scopeLabel = 'Presupuesto general'; }
  else if (f.person !== 'all') { const p = findPerson(f.person); budget = p?.budget || 0; scopeLabel = `Presupuesto de ${p?.name || ''}`; }

  // Para el "disponible" usamos todo lo gastado en ese ámbito (sin filtros de lugar/periodo).
  const scopeAll = all.filter((e) => f.person === 'all' || (e.personId || GENERAL) === f.person);
  const spentScope = sum(scopeAll, (e) => e.totalUsd);
  const spent = sum(exps, (e) => e.totalUsd);
  const fees = sum(exps, (e) => e.feeUsd || 0);
  const spentToday = sum(scopeAll.filter((e) => e.date === today), (e) => e.totalUsd);
  const left = budget - spentScope;

  // Días transcurridos: desde el inicio del viaje (o el primer gasto) hasta hoy.
  const t = state.trip;
  const dates = scopeAll.map((e) => e.date).sort();
  const from = t.start || dates[0];
  const to = t.end && t.end < today ? t.end : today;
  const elapsed = from && today >= from ? Math.max(1, daysBetween(from, to) + 1) : 0;
  const dailySpent = sum(scopeAll.filter(isDaily), (e) => e.totalUsd);
  const fixedNames = state.categories.filter((c) => c.fixed).map((c) => c.name.toLowerCase());
  const avgLine = `<div class="kpi"><span>Promedio / día</span><b>${elapsed ? money(spentScope / elapsed) : '—'}</b></div>`;
  let daysLine = `
      <div class="kpi wide"><span>Promedio diario sin ${esc(fixedNames.join(' ni ') || 'gastos fijos')}</span><b ${elapsed ? `data-count="${dailySpent / elapsed}"` : ''}>${elapsed ? money(dailySpent / elapsed) : '—'}</b></div>`;
  if (t.start && t.end) {
    const total = daysBetween(t.start, t.end) + 1;
    const remaining = today < t.start ? total : Math.max(0, daysBetween(today, t.end) + 1);
    daysLine += `
      <div class="kpi"><span>Días restantes</span><b>${remaining}</b></div>
      <div class="kpi ${left < 0 ? 'neg' : ''}"><span>Disponible / día</span><b>${remaining ? money(left / remaining) : '—'}</b></div>`;
  }

  const filterActive = f.place !== 'all' || f.period !== 'all';
  el.innerHTML = `
    <div class="filters">
      <div class="chips scroll" data-f="person">
        <button type="button" class="chip ${f.person === 'all' ? 'on' : ''}" data-v="all">Todos</button>
        <button type="button" class="chip ${f.person === GENERAL ? 'on' : ''}" data-v="${GENERAL}">👥 General</button>
        ${state.people.map((p) => `<button type="button" class="chip ${f.person === p.id ? 'on' : ''}" data-v="${p.id}"><i class="dot" style="background:${p.color}"></i>${esc(p.name)}</button>`).join('')}
      </div>
      <div class="field-row tight">
        <select data-sel="place" aria-label="Lugar">
          <option value="all">📍 Todos los lugares</option>
          ${state.places.map((p) => `<option value="${p.id}" ${f.place === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
        <select data-sel="period" aria-label="Periodo">
          <option value="all" ${f.period === 'all' ? 'selected' : ''}>🗓 Todo el viaje</option>
          <option value="today" ${f.period === 'today' ? 'selected' : ''}>Hoy</option>
          <option value="7d" ${f.period === '7d' ? 'selected' : ''}>Últimos 7 días</option>
        </select>
      </div>
    </div>

    <section class="hero summary">
      <div class="summary-top">
        ${ring(budget > 0 ? spentScope / budget : 0)}
        <div class="summary-nums">
          <div class="kpi"><span>${esc(scopeLabel)}</span><b data-count="${budget}">${money(budget)}</b></div>
          <div class="kpi"><span>Gastado</span><b data-count="${spentScope}">${money(spentScope)}</b></div>
          <div class="kpi ${left < 0 ? 'neg' : 'pos'}"><span>Disponible</span><b data-count="${left}">${money(left)}</b></div>
        </div>
      </div>
      <div class="kpi-grid">
        <div class="kpi"><span>Hoy</span><b data-count="${spentToday}">${money(spentToday)}</b></div>
        ${avgLine}
        <div class="kpi"><span>Comisiones</span><b>${money(sum(scopeAll, (e) => e.feeUsd || 0))}</b></div>
        ${daysLine}
      </div>
      ${filterActive ? `<div class="filter-note">Con filtros: <b>${money(spent)}</b> en ${exps.length} gastos${fees ? ` (comisiones ${money(fees)})` : ''}</div>` : ''}
    </section>

    ${f.person === 'all' ? accountsSection(exps, filterActive) : ''}
    ${peopleSection(exps)}
    ${categoriesSection(exps)}
    ${daysSection(exps)}
    ${placesSection(exps)}
    ${merchantsSection(exps)}`;

  bind(el, exps);
  animateIn(el, anim);
}

function accountsSection(exps, filterActive) {
  const all = groupSum(alive(), (e) => e.accountId);
  const fl = groupSum(exps, (e) => e.accountId);
  if (!state.accounts.length) return '';
  return `
    <section class="card">
      <h3 class="card-title">Cuentas <small>disponible por cuenta</small></h3>
      ${state.accounts.map((a) => {
        const s = all.get(a.id) || 0;
        return barRow({ label: `💳 ${esc(a.name)}`, spent: s, budget: a.balance, sub: filterActive && fl.get(a.id) ? ` · filtro ${money(fl.get(a.id))}` : '' });
      }).join('')}
    </section>`;
}

function peopleSection(exps) {
  const by = groupSum(exps, (e) => e.personId || GENERAL);
  const b = budgetSummary();
  const rows = [{ id: GENERAL, name: '👥 General', color: 'var(--muted-2)', budget: b.general }].concat(
    state.people.map((p) => ({ id: p.id, name: `<i class="dot" style="background:${p.color}"></i>${esc(p.name)}`, color: p.color, budget: p.budget })),
  );
  const shown = f.person === 'all' ? rows : rows.filter((r) => r.id === f.person);
  return `
    <section class="card">
      <h3 class="card-title">Por persona <small>personal vs presupuesto</small></h3>
      ${shown.map((r) => barRow({ label: r.name, spent: by.get(r.id) || 0, budget: r.budget, color: r.color })).join('')}
    </section>`;
}

function categoriesSection(exps) {
  const scoped = f.catScope === 'general' ? exps.filter((e) => (e.personId || GENERAL) === GENERAL) : exps;
  const by = groupSum(scoped, (e) => e.categoryId);
  const max = Math.max(0, ...by.values());
  const cats = [...state.categories].sort((a, b) => (by.get(b.id) || 0) - (by.get(a.id) || 0));
  const useBudget = f.catScope === 'general';
  return `
    <section class="card">
      <div class="card-title-row">
        <h3 class="card-title">Por categoría</h3>
        <div class="mini-seg" data-f="catScope">
          <button type="button" class="${f.catScope === 'general' ? 'on' : ''}" data-v="general">General</button>
          <button type="button" class="${f.catScope === 'todo' ? 'on' : ''}" data-v="todo">Todo</button>
        </div>
      </div>
      ${cats.filter((c) => (by.get(c.id) || 0) > 0 || (useBudget && c.budget > 0)).map((c) =>
        barRow({ label: `${esc(c.icon)} ${esc(c.name)}`, spent: by.get(c.id) || 0, budget: useBudget ? c.budget : 0, max })).join('') || '<p class="muted small">Sin gastos en este ámbito.</p>'}
      ${useBudget ? '' : '<p class="hint">"Todo" incluye gastos personales (sin presupuesto por categoría).</p>'}
    </section>`;
}

function daysSection(exps) {
  const by = groupSum(exps, (e) => e.date);
  if (by.size < 1) return '';
  const days = [...by.keys()].sort();
  const first = state.trip.start && state.trip.start < days[0] && f.period === 'all' ? state.trip.start : days[0];
  const last = days[days.length - 1];
  const list = [];
  for (let d = first; d <= last && list.length < 120; d = addDays(d, 1)) list.push(d);
  const max = Math.max(...by.values());
  const today = todayISO();
  return `
    <section class="card">
      <h3 class="card-title">Por día</h3>
      <div class="day-chart">
        ${list.map((d) => {
          const v = by.get(d) || 0;
          return `<button type="button" class="day-col ${d === today ? 'today' : ''}" data-day="${d}" title="${fmtDay(d)}: ${money(v)}">
            <span class="dv">${v ? money(v, 'USD', { compact: true }) : ''}</span>
            <span class="db"><i style="height:${max ? (v / max) * 100 : 0}%"></i></span>
            <span class="dl">${Number(d.slice(8))}</span>
          </button>`;
        }).join('')}
      </div>
    </section>`;
}

function placesSection(exps) {
  if (!state.places.length || f.place !== 'all') return '';
  const by = groupSum(exps, (e) => e.placeId || '');
  const max = Math.max(0, ...by.values());
  const rows = [...by.entries()].sort((a, b) => b[1] - a[1]);
  return `
    <section class="card">
      <h3 class="card-title">Por lugar</h3>
      ${rows.map(([k, v]) => {
        const p = state.places.find((x) => x.id === k);
        const nights = p?.start && p?.end ? daysBetween(p.start, p.end) || 1 : 0;
        return barRow({ label: `📍 ${esc(p?.name || 'Sin lugar')}`, spent: v, budget: 0, max, sub: nights ? `${money(v / nights)} por noche` : '' });
      }).join('')}
    </section>`;
}

function merchantsSection(exps) {
  const by = groupSum(exps.filter((e) => e.merchant), (e) => e.merchant.trim().toLowerCase());
  if (!by.size) return '';
  const names = new Map(exps.filter((e) => e.merchant).map((e) => [e.merchant.trim().toLowerCase(), e.merchant.trim()]));
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return `
    <section class="card">
      <h3 class="card-title">Top establecimientos</h3>
      <ol class="rank">${top.map(([k, v]) => `<li><span>${esc(names.get(k))}</span><b>${money(v)}</b></li>`).join('')}</ol>
    </section>`;
}

function drill(title, list) {
  const sorted = [...list].sort((a, b) => (a.date < b.date ? 1 : -1));
  openSheet({
    title,
    body: `<p class="muted small">${sorted.length} gastos · ${money(sum(sorted, (e) => e.totalUsd))}</p><div class="list">${sorted.map(expenseRow).join('') || '<p class="muted">Sin gastos.</p>'}</div>`,
    onMount(s, close) {
      s.addEventListener('click', (e) => {
        const b = e.target.closest('[data-edit]');
        if (!b) return;
        close();
        editExpense(b.dataset.edit);
      });
    },
  });
}

function bind(el, exps) {
  el.onclick = (e) => {
    const chip = e.target.closest('[data-f] [data-v]');
    if (chip) {
      const key = chip.closest('[data-f]').dataset.f;
      f[key] = chip.dataset.v;
      persist();
      refresh();
      return;
    }
    const day = e.target.closest('[data-day]');
    if (day) drill(fmtDay(day.dataset.day), exps.filter((x) => x.date === day.dataset.day));
  };
  el.onchange = (e) => {
    const s = e.target.dataset.sel;
    if (!s) return;
    f[s] = e.target.value;
    persist();
    refresh();
  };
}

/** Re-dibuja tras cambiar un filtro sin perder el scroll (vertical ni de las filas de chips). */
function refresh() {
  const y = window.scrollY;
  const xs = [...root.querySelectorAll('.chips.scroll, .day-chart')].map((n) => n.scrollLeft);
  render(root, 'soft');
  root.querySelectorAll('.chips.scroll, .day-chart').forEach((n, i) => (n.scrollLeft = xs[i] || 0));
  window.scrollTo(0, y);
}
