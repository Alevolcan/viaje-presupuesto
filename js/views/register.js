// Pestaña Registro: formulario de gasto (con conversión EUR→USD y comisión) e historial.
import { state, save, uid, todayISO, GENERAL, findAccount, findCategory, findPerson, findPlace } from '../store.js';
import { esc, money, rateFmt, parseNum, numIn, toast, emptyState, fmtDay, fmtDate, vibrate, animateIn, initSegmented, slideSegment } from '../ui.js';
import { computeCharge, placeForDate, alive, sum, hasFee, feeApplies } from '../calc.js';
import { eurToUsd } from '../fx.js';
import { feeLabel } from './budget.js';

export const title = 'Registro';

let mode = 'nuevo';
let form = null;
let editingId = null;
let search = '';
let root;
let justSaved = false;

function blankForm() {
  const p = state.prefs;
  const keep = (id, finder) => (id && finder(id) ? id : '');
  const date = todayISO();
  return {
    amount: '',
    currency: p.currency || 'EUR',
    rate: null,
    rateInfo: null,
    rateManual: false,
    accountId: keep(p.accountId, findAccount) || state.accounts[0]?.id || '',
    personId: p.personId === GENERAL || findPerson(p.personId) ? p.personId : GENERAL,
    merchant: '',
    categoryId: '',
    sub: '',
    date,
    placeId: placeForDate(date) || keep(p.placeId, findPlace),
    note: '',
  };
}

function formFromExpense(e) {
  return {
    amount: numIn(e.amount),
    currency: e.currency,
    rate: e.rate,
    rateInfo: e.currency === 'EUR' ? { source: 'guardada', date: e.date } : null,
    rateManual: true,
    accountId: e.accountId,
    personId: e.personId || GENERAL,
    merchant: e.merchant || '',
    categoryId: e.categoryId,
    sub: e.sub || '',
    date: e.date,
    placeId: e.placeId || '',
    note: e.note || '',
  };
}

/** Abre un gasto existente en el formulario (usado también desde el dashboard). */
export function editExpense(id) {
  const e = state.expenses.find((x) => x.id === id);
  if (!e) return;
  editingId = id;
  form = formFromExpense(e);
  mode = 'nuevo';
  if (location.hash !== '#registro') location.hash = '#registro';
  else render(root);
}

export function render(el, anim = 'enter') {
  root = el;
  if (!form) form = blankForm();
  el.innerHTML = `
    <div class="segmented" role="tablist">
      <button type="button" class="${mode === 'nuevo' ? 'on' : ''}" data-mode="nuevo">${editingId ? 'Editar' : 'Nuevo gasto'}</button>
      <button type="button" class="${mode === 'historial' ? 'on' : ''}" data-mode="historial">Historial <span class="count">${alive().length}</span></button>
    </div>
    <div id="reg-body"></div>`;
  el.querySelector('.segmented').onclick = (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    slideSegment(b);
    renderBody('enter');
  };
  renderBody(anim);
}

function renderBody(anim) {
  const body = root.querySelector('#reg-body');
  if (mode === 'nuevo') renderForm(body);
  else renderHistory(body);
  animateIn(body, anim);
  initSegmented(root);
  if (justSaved && mode === 'nuevo') {
    justSaved = false;
    const card = body.querySelector('.amount-card');
    card?.insertAdjacentHTML('beforeend', '<div class="saved-burst"><span>✓</span></div>');
    setTimeout(() => body.querySelector('.saved-burst')?.remove(), 1400);
  }
}

/* ================= FORMULARIO ================= */

function chip(group, value, label, on, extra = '') {
  return `<button type="button" class="chip ${on ? 'on' : ''}" data-group="${group}" data-v="${esc(value)}" ${extra}>${label}</button>`;
}

function subChips() {
  const c = findCategory(form.categoryId);
  if (!c) return '<p class="hint">Elige una categoría para ver sus subcategorías.</p>';
  const subs = [...c.subs];
  if (form.sub && !subs.includes(form.sub)) subs.push(form.sub);
  return `<div class="chips wrap">${subs.map((s) => chip('sub', s, esc(s), form.sub === s)).join('')}</div>`;
}

function renderForm(el) {
  if (!state.accounts.length) {
    el.innerHTML = emptyState('Primero agrega al menos una cuenta en <b>Presupuesto → Cuentas</b>.', '💳') +
      '<a class="btn primary block" href="#presupuesto">Ir a Presupuesto</a>';
    return;
  }
  const merchants = [...new Set(alive().map((e) => (e.merchant || '').trim()).filter(Boolean))].slice(-200);
  el.innerHTML = `
    <form class="reg" autocomplete="off" novalidate>
      ${editingId ? `<div class="edit-banner">✎ Editando un gasto <button type="button" class="link" data-act="cancel">Cancelar</button></div>` : ''}
      <div class="amount-card hero">
        <svg class="flight" viewBox="0 0 340 230" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <circle cx="-4" cy="196" r="4" class="flight-dot"/>
          <path d="M-4 196 C 80 176, 170 64, 296 50" class="flight-path"/>
          <g class="flight-plane" transform="translate(304 49) rotate(86) translate(-12 -12)">
            <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
          </g>
        </svg>
        <div class="cur-toggle" role="radiogroup" aria-label="Moneda">
          ${chip('currency', 'EUR', '€ EUR', form.currency === 'EUR')}
          ${chip('currency', 'USD', '$ USD', form.currency === 'USD')}
        </div>
        <label class="amount-input">
          <span class="sym" id="sym">${form.currency === 'EUR' ? '€' : '$'}</span>
          <input id="amount" inputmode="decimal" placeholder="0,00" value="${esc(form.amount)}" aria-label="Monto" enterkeyhint="done">
        </label>
        <div id="fx-line" class="fx-line"></div>
        <div id="charge-line" class="charge-line"></div>
      </div>

      <div class="group">
        <div class="label">Cuenta donde se debitó</div>
        <div class="chips scroll">${state.accounts.map((a) => chip('accountId', a.id, `${esc(a.name)}${hasFee(a) ? ' <small>•</small>' : ''}`, form.accountId === a.id)).join('')}</div>
        <div class="hint" id="acc-hint"></div>
      </div>

      <div class="group">
        <div class="label">¿De quién es el gasto?</div>
        <div class="chips wrap">
          ${chip('personId', GENERAL, '👥 General', form.personId === GENERAL)}
          ${state.people.map((p) => chip('personId', p.id, `<i class="dot" style="background:${p.color}"></i>${esc(p.name)}`, form.personId === p.id)).join('')}
        </div>
      </div>

      <div class="group">
        <div class="label">Categoría</div>
        <div class="chips grid">${state.categories.map((c) => chip('categoryId', c.id, `<span class="ci">${esc(c.icon)}</span><span>${esc(c.name)}</span>`, form.categoryId === c.id)).join('')}</div>
      </div>

      <div class="group">
        <div class="label">Subcategoría</div>
        <div id="subs">${subChips()}</div>
      </div>

      <label class="field"><span>Establecimiento</span><input id="merchant" list="merchants" value="${esc(form.merchant)}" placeholder="Ej. Mercado San Miguel" enterkeyhint="done"></label>
      <datalist id="merchants">${merchants.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>

      <div class="field-row">
        <label class="field"><span>Fecha</span><input type="date" id="date" value="${form.date}"></label>
        <label class="field"><span>Lugar</span>
          <select id="place">
            <option value="">—</option>
            ${state.places.map((p) => `<option value="${p.id}" ${form.placeId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
        </label>
      </div>

      <label class="field"><span>Nota (opcional)</span><input id="note" value="${esc(form.note)}" placeholder="Detalle adicional" enterkeyhint="done"></label>

      <div class="sticky-actions">
        ${editingId ? '<button type="button" class="btn danger-ghost" data-act="delete">Eliminar</button>' : ''}
        <button type="submit" class="btn primary grow" id="submit">${editingId ? 'Guardar cambios' : 'Registrar gasto'}</button>
      </div>
    </form>`;

  const $ = (s) => el.querySelector(s);
  const amountEl = $('#amount');
  // El campo crece con el número para que el símbolo quede pegado a la cifra.
  const fitAmount = () => (amountEl.style.width = `${Math.max(4, amountEl.value.length || 4) + 0.5}ch`);
  fitAmount();

  const updateLines = () => {
    const amount = parseNum(form.amount);
    const acc = findAccount(form.accountId);
    const fx = $('#fx-line');
    if (form.currency === 'EUR') {
      const info = form.rateInfo;
      const status = info?.loading
        ? 'buscando tasa…'
        : info?.error
          ? `<span class="neg">${esc(info.error)}</span>`
          : info
            ? `${esc(info.source)}${info.date ? ' · ' + fmtDate(info.date) : ''}${info.stale ? ' · <span class="warn-t">sin conexión, última conocida</span>' : ''}${info.approx ? ' · aprox.' : ''}${form.rateManual && info.source !== 'guardada' ? ' · manual' : ''}`
            : '';
      fx.innerHTML = `
        <span>1 € =</span>
        <input id="rate" inputmode="decimal" value="${form.rate ? rateFmt(form.rate) : ''}" placeholder="tasa" aria-label="Tasa EUR a USD">
        <span>$</span>
        <span class="fx-status">${status}</span>
        <button type="button" class="icon-btn small ${info?.loading ? 'spin' : ''}" data-act="refresh-rate" aria-label="Actualizar tasa">↻</button>`;
      fx.hidden = false;
    } else {
      fx.hidden = true;
      fx.innerHTML = '';
    }
    const ch = computeCharge({ amount, currency: form.currency, rate: form.rate, account: acc });
    const line = $('#charge-line');
    if (!amount) line.innerHTML = '<span class="muted">Escribe el monto</span>';
    else if (form.currency === 'EUR' && !form.rate) line.innerHTML = '<span class="muted">Falta la tasa de cambio</span>';
    else {
      const parts = [];
      if (form.currency === 'EUR') parts.push(`${money(ch.amountUsd)}`);
      if (ch.feeUsd) parts.push(`+ comisión ${money(ch.feeUsd)}`);
      line.innerHTML = `${parts.length ? `<span class="muted">${parts.join(' ')} =</span> ` : ''}<b>${money(ch.totalUsd)}</b> <span class="muted">cargado a la cuenta</span>`;
    }
    $('#acc-hint').textContent = acc ? `${feeLabel(acc)}${hasFee(acc) && !feeApplies(acc, form.currency) ? ' (no aplica en USD)' : ''}` : '';
  };

  const loadRate = async (force = false) => {
    if (form.currency !== 'EUR') return;
    if (form.rateManual && !force && form.rate) return updateLines();
    form.rateInfo = { loading: true };
    updateLines();
    const forDate = form.date;
    try {
      const r = await eurToUsd(forDate);
      if (form.date !== forDate || form.currency !== 'EUR') return;
      form.rate = r.rate;
      form.rateInfo = r;
      form.rateManual = false;
    } catch (err) {
      form.rateInfo = { error: 'Sin tasa: escríbela a mano' };
    }
    if (root.contains(el)) updateLines();
  };

  updateLines();
  if (form.currency === 'EUR' && !form.rate) loadRate();

  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'amount') form.amount = t.value;
    else if (t.id === 'rate') {
      form.rate = parseNum(t.value) || null;
      form.rateManual = true;
      const line = $('#charge-line');
      // Actualiza solo el total para no perder el foco del campo de tasa.
      const ch = computeCharge({ amount: parseNum(form.amount), currency: 'EUR', rate: form.rate, account: findAccount(form.accountId) });
      if (parseNum(form.amount) && form.rate) line.innerHTML = `<b>${money(ch.totalUsd)}</b> <span class="muted">cargado a la cuenta</span>`;
      return;
    } else if (t.id === 'merchant') form.merchant = t.value;
    else if (t.id === 'note') form.note = t.value;
    else return;
    if (t.id === 'amount') {
      fitAmount();
      updateLines();
    }
  });
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'date') {
      form.date = t.value || todayISO();
      const auto = placeForDate(form.date);
      if (auto) {
        form.placeId = auto;
        $('#place').value = auto;
      }
      if (form.currency === 'EUR') loadRate(true);
    } else if (t.id === 'place') form.placeId = t.value;
    else if (t.id === 'rate') updateLines();
  });

  el.addEventListener('click', (e) => {
    const c = e.target.closest('.chip[data-group]');
    if (c) {
      const g = c.dataset.group;
      const v = c.dataset.v;
      if (g === 'sub') form.sub = form.sub === v ? '' : v;
      else form[g] = v;
      c.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x.dataset.v === form[g]));
      if (g === 'categoryId') {
        form.sub = '';
        $('#subs').innerHTML = subChips();
      }
      if (g === 'currency') {
        $('#sym').textContent = v === 'EUR' ? '€' : '$';
        if (v === 'EUR' && !form.rate) loadRate(true);
        else updateLines();
      }
      if (g === 'accountId') updateLines();
      vibrate(8);
      return;
    }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'refresh-rate') loadRate(true);
    if (a.dataset.act === 'cancel') {
      editingId = null;
      form = blankForm();
      render(root);
    }
    if (a.dataset.act === 'delete') {
      const exp = state.expenses.find((x) => x.id === editingId);
      if (!exp || !confirm('¿Eliminar este gasto?')) return;
      exp.deleted = true;
      exp.updatedAt = Date.now();
      save();
      editingId = null;
      form = blankForm();
      toast('Gasto eliminado');
      mode = 'historial';
      render(root);
    }
  });

  el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseNum(form.amount);
    const acc = findAccount(form.accountId);
    if (!(amount > 0)) return toast('Escribe un monto válido', 'err'), amountEl.focus();
    if (!acc) return toast('Elige la cuenta', 'err');
    if (form.currency === 'EUR' && !(form.rate > 0)) return toast('Falta la tasa de cambio', 'err');
    if (!findCategory(form.categoryId)) return toast('Elige una categoría', 'err');
    const ch = computeCharge({ amount, currency: form.currency, rate: form.rate, account: acc });
    const now = Date.now();
    const data = {
      date: form.date || todayISO(),
      accountId: acc.id,
      currency: form.currency,
      amount,
      rate: form.currency === 'EUR' ? form.rate : 1,
      ...ch,
      feePct: feeApplies(acc, form.currency) ? acc.feePct || 0 : 0,
      personId: form.personId || GENERAL,
      merchant: form.merchant.trim(),
      categoryId: form.categoryId,
      sub: form.sub,
      placeId: form.placeId,
      note: form.note.trim(),
      updatedAt: now,
    };
    if (editingId) {
      Object.assign(state.expenses.find((x) => x.id === editingId), data);
    } else {
      state.expenses.push({ id: uid(), createdAt: now, ...data });
    }
    state.prefs = { ...state.prefs, accountId: acc.id, personId: data.personId, currency: data.currency, placeId: data.placeId };
    save();
    vibrate(20);
    toast(editingId ? 'Cambios guardados' : `Registrado ${money(ch.totalUsd)}`, 'ok');
    const wasEditing = !!editingId;
    editingId = null;
    const keep = { currency: form.currency, rate: form.rate, rateInfo: form.rateInfo, rateManual: false, date: form.date, placeId: form.placeId };
    form = { ...blankForm(), ...(wasEditing ? {} : keep) };
    if (wasEditing) mode = 'historial';
    else justSaved = true;
    render(root, wasEditing ? 'enter' : 'soft');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* ================= HISTORIAL ================= */

export function expenseRow(e) {
  const c = findCategory(e.categoryId);
  const p = e.personId === GENERAL ? null : findPerson(e.personId);
  const pl = findPlace(e.placeId);
  const titleTxt = e.merchant || e.sub || c?.name || 'Gasto';
  const meta = [c ? (e.sub ? `${c.name} · ${e.sub}` : c.name) : null, p ? p.name : 'General', pl?.name].filter(Boolean).join(' · ');
  return `
    <button type="button" class="list-item tx" data-edit="${e.id}">
      <span class="li-icon">${esc(c?.icon || '•')}</span>
      <span class="li-main"><b>${esc(titleTxt)}</b><small>${p ? `<i class="dot" style="background:${p.color}"></i>` : ''}${esc(meta)}</small></span>
      <span class="li-end"><b>${money(e.totalUsd)}</b><small>${e.currency === 'EUR' ? money(e.amount, 'EUR') : ''}${e.feeUsd ? `${e.currency === 'EUR' ? ' · ' : ''}+${money(e.feeUsd)}` : ''}</small></span>
    </button>`;
}

function renderHistory(el) {
  el.innerHTML = `
    <div class="search"><input type="search" id="q" placeholder="Buscar establecimiento, categoría, persona…" value="${esc(search)}"></div>
    <div id="hist"></div>`;
  const draw = () => {
    const q = search.trim().toLowerCase();
    const list = alive()
      .filter((e) => {
        if (!q) return true;
        const c = findCategory(e.categoryId);
        const hay = [e.merchant, e.sub, e.note, c?.name, findPerson(e.personId)?.name, e.personId === GENERAL ? 'general' : '', findPlace(e.placeId)?.name, findAccount(e.accountId)?.name]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
    const byDay = new Map();
    for (const e of list) (byDay.get(e.date) || byDay.set(e.date, []).get(e.date)).push(e);
    el.querySelector('#hist').innerHTML = list.length
      ? `<p class="muted small">${list.length} gastos · ${money(sum(list, (e) => e.totalUsd))}</p>` +
        [...byDay].map(([d, xs]) => `
          <div class="day-head"><span>${fmtDay(d)}</span><span>${money(sum(xs, (e) => e.totalUsd))}</span></div>
          <div class="list">${xs.map(expenseRow).join('')}</div>`).join('')
      : emptyState(q ? 'Nada coincide con la búsqueda.' : 'Aún no hay gastos registrados.', '🧾');
  };
  draw();
  el.querySelector('#q').addEventListener('input', (e) => {
    search = e.target.value;
    draw();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit]');
    if (b) editExpense(b.dataset.edit);
  });
}
