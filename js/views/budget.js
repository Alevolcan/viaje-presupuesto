// Pestaña Presupuesto: cuentas, reparto (personas / general / categorías), lugares y ajustes.
import { state, save, uid, PERSON_COLORS, replaceState, freshState, findAccount, findCategory, findPlace, findPerson } from '../store.js';
import { esc, money, parseNum, numIn, openSheet, toast, emptyState, fmtDate, daysBetween, refreshApp, animateIn, initSegmented, slideSegment, getTheme, setTheme } from '../ui.js';
import { budgetSummary, alive, groupSum, sum, hasFee } from '../calc.js';
import { sampleState } from '../sample.js';
import { isLinked, tripId, createShared, joinTrip, unlink, parseTripId, shareUrl, syncNow, syncInfo, onSync } from '../sync.js';

export const title = 'Presupuesto';

const SEGS = [['cuentas', 'Cuentas'], ['reparto', 'Reparto'], ['lugares', 'Lugares'], ['ajustes', 'Ajustes']];
let seg = sessionStorage.getItem('budget.seg') || 'cuentas';
let root;

export function render(el, mode = 'enter') {
  root = el;
  el.innerHTML = `
    <div class="segmented" role="tablist">
      ${SEGS.map(([k, l]) => `<button type="button" role="tab" class="${k === seg ? 'on' : ''}" data-seg="${k}">${l}</button>`).join('')}
    </div>
    <div id="seg-body"></div>`;
  el.querySelector('.segmented').onclick = (e) => {
    const b = e.target.closest('[data-seg]');
    if (!b || b.dataset.seg === seg) return;
    seg = b.dataset.seg;
    sessionStorage.setItem('budget.seg', seg);
    slideSegment(b);
    renderBody('enter');
  };
  renderBody(mode);
}

function renderBody(mode) {
  const body = root.querySelector('#seg-body');
  ({ cuentas: renderAccounts, reparto: renderSplit, lugares: renderPlaces, ajustes: renderSettings })[seg](body);
  animateIn(body, mode);
  initSegmented(root);
}
const rerender = () => renderBody('soft');

/* ================= CUENTAS ================= */

export function feeLabel(a) {
  if (!hasFee(a)) return 'Sin comisión';
  const parts = [];
  if (a.feePct) parts.push(`${String(a.feePct).replace('.', ',')}%`);
  if (a.feeFixed) parts.push(`${money(a.feeFixed)} fijo`);
  return `${parts.join(' + ')} ${a.feeOnlyForeign ? 'en EUR' : 'siempre'}`;
}

function renderAccounts(el) {
  const spent = groupSum(alive(), (e) => e.accountId);
  const total = sum(state.accounts, (a) => a.balance);
  const used = sum(state.accounts, (a) => spent.get(a.id) || 0);
  el.innerHTML = `
    <div class="hero hero-mini">
      <div class="label">Total disponible en cuentas</div>
      <div class="big" data-count="${total}">${money(total)}</div>
      <div class="muted small">${state.accounts.length} ${state.accounts.length === 1 ? 'cuenta' : 'cuentas'} · gastado ${money(used)} · quedan <b>${money(total - used)}</b></div>
    </div>
    <div class="list">
      ${state.accounts.map((a) => {
        const s = spent.get(a.id) || 0;
        const w = a.balance > 0 ? Math.min(100, (s / a.balance) * 100) : 0;
        return `
        <button type="button" class="list-item" data-act="edit" data-id="${a.id}">
          <span class="li-icon">💳</span>
          <span class="li-main">
            <b>${esc(a.name)}</b>
            <small><span class="badge ${hasFee(a) ? 'warn' : 'ok'}">${esc(feeLabel(a))}</span></small>
            <span class="bar thin"><i style="width:${w}%" class="${s > a.balance ? 'over' : ''}"></i></span>
          </span>
          <span class="li-end"><b>${money(a.balance - s)}</b><small>de ${money(a.balance)}</small></span>
        </button>`;
      }).join('') || emptyState('Agrega las cuentas o tarjetas que usarán en el viaje y cuánto hay disponible en cada una.', '💳')}
    </div>
    <button type="button" class="btn block soft" data-act="add">＋ Agregar cuenta</button>`;
  el.onclick = (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'add') accountSheet();
    if (t.dataset.act === 'edit') accountSheet(t.dataset.id);
  };
}

function accountSheet(id) {
  const orig = id && findAccount(id);
  const a = orig ? { ...orig } : { name: '', balance: 0, feePct: 0, feeFixed: 0, feeOnlyForeign: true };
  openSheet({
    title: orig ? 'Editar cuenta' : 'Nueva cuenta',
    body: `
      <label class="field"><span>Nombre de la cuenta / tarjeta</span><input name="name" value="${esc(a.name)}" placeholder="Ej. Visa Banco X" autocomplete="off"></label>
      <label class="field"><span>Monto disponible para el viaje (USD)</span><input name="balance" inputmode="decimal" value="${numIn(a.balance)}" placeholder="0,00"></label>
      <div class="field-row">
        <label class="field"><span>Comisión (%)</span><input name="feePct" inputmode="decimal" value="${numIn(a.feePct)}" placeholder="0"></label>
        <label class="field"><span>Fija por uso (USD)</span><input name="feeFixed" inputmode="decimal" value="${numIn(a.feeFixed)}" placeholder="0"></label>
      </div>
      <label class="switch"><input type="checkbox" name="feeOnlyForeign" ${a.feeOnlyForeign ? 'checked' : ''}><span class="track"></span><span>Cobrar la comisión solo en compras en EUR</span></label>
      <p class="hint">Cada gasto con esta cuenta sumará la comisión automáticamente al monto cargado.</p>`,
    footer: `${orig ? '<button type="button" class="btn danger-ghost" data-del>Eliminar</button>' : ''}<button type="button" class="btn primary grow" data-ok>Guardar</button>`,
    onMount(s, close) {
      const v = (n) => s.querySelector(`[name="${n}"]`);
      if (!orig) setTimeout(() => v('name').focus(), 300);
      s.querySelector('[data-ok]').onclick = () => {
        const next = {
          name: v('name').value.trim(),
          balance: parseNum(v('balance').value),
          feePct: parseNum(v('feePct').value),
          feeFixed: parseNum(v('feeFixed').value),
          feeOnlyForeign: v('feeOnlyForeign').checked,
        };
        if (!next.name) return toast('Ponle un nombre a la cuenta', 'err');
        if (orig) Object.assign(orig, next);
        else state.accounts.push({ id: uid(), ...next });
        save();
        close();
        rerender();
      };
      s.querySelector('[data-del]')?.addEventListener('click', () => {
        const n = alive().filter((e) => e.accountId === id).length;
        if (n) return toast(`No se puede eliminar: tiene ${n} gasto(s) registrados`, 'err');
        if (!confirm(`¿Eliminar la cuenta "${orig.name}"?`)) return;
        state.accounts = state.accounts.filter((x) => x.id !== id);
        save();
        close();
        rerender();
      });
    },
  });
}

/* ================= REPARTO ================= */

function renderSplit(el) {
  const b = budgetSummary();
  el.innerHTML = `
    <div class="card">
      <div class="row-between"><span class="label">Total disponible</span><b class="big-2" data-k="total">${money(b.total)}</b></div>
      <div class="stack-bar" data-k="stack"></div>
      <div class="legend" data-k="legend"></div>
      ${b.total ? '' : '<p class="hint">El total sale de la suma de tus cuentas. Agrégalas en la pestaña <b>Cuentas</b>.</p>'}
    </div>

    <h3 class="section-title">Gastos personales <small>cuánto tiene cada quien para sí</small></h3>
    <div class="list">
      ${state.people.map((p) => `
        <div class="list-item static">
          <button type="button" class="dot-btn" data-act="person" data-id="${p.id}" style="--c:${p.color}" aria-label="Opciones de ${esc(p.name)}"></button>
          <input class="inline grow" data-pid="${p.id}" data-f="name" value="${esc(p.name)}" aria-label="Nombre">
          <span class="money-in"><span>$</span><input class="inline num" data-pid="${p.id}" data-f="budget" inputmode="decimal" value="${numIn(p.budget)}" placeholder="0" aria-label="Presupuesto personal de ${esc(p.name)}"></span>
        </div>`).join('')}
    </div>
    <button type="button" class="btn block soft" data-act="add-person">＋ Agregar persona</button>

    <div class="card accent-card">
      <div class="row-between"><span><b>General (compartido)</b><br><small class="muted">Total − personales</small></span><b class="big-2" data-k="general">${money(b.general)}</b></div>
    </div>

    <h3 class="section-title">Categorías del general <small>toca una para editar subcategorías</small></h3>
    <div class="list">
      ${state.categories.map((c) => `
        <div class="list-item static">
          <button type="button" class="cat-btn grow" data-act="cat" data-id="${c.id}">
            <span class="li-icon">${esc(c.icon)}</span>
            <span class="li-main"><b>${esc(c.name)}</b><small>${c.subs.length} subcategorías${c.fixed ? ' · fuera del promedio diario' : ''}</small></span>
          </button>
          <span class="money-in"><span>$</span><input class="inline num" data-cid="${c.id}" inputmode="decimal" value="${numIn(c.budget)}" placeholder="0" aria-label="Presupuesto de ${esc(c.name)}"></span>
        </div>`).join('')}
    </div>
    <div class="card compact">
      <div class="row-between small"><span>Asignado a categorías</span><b data-k="assigned"></b></div>
      <div class="row-between small"><span>Sin asignar del general</span><b data-k="unassigned"></b></div>
    </div>
    <button type="button" class="btn block soft" data-act="add-cat">＋ Agregar categoría</button>`;

  const refresh = () => {
    const b = budgetSummary();
    const q = (k) => el.querySelector(`[data-k="${k}"]`);
    q('total').textContent = money(b.total);
    q('general').textContent = money(b.general);
    q('general').classList.toggle('neg', b.general < 0);
    q('assigned').textContent = money(b.assigned);
    q('unassigned').textContent = money(b.unassigned);
    q('unassigned').classList.toggle('neg', b.unassigned < 0);
    const base = Math.max(b.total, b.personal) || 1;
    const segs = state.people.map((p) => ({ c: p.color, v: p.budget, n: p.name })).concat([{ c: 'var(--muted-2)', v: Math.max(0, b.general), n: 'General' }]);
    q('stack').innerHTML = segs.map((s) => `<i style="width:${(s.v / base) * 100}%;background:${s.c}"></i>`).join('');
    q('legend').innerHTML = segs.map((s) => `<span><i style="background:${s.c}"></i>${esc(s.n)} ${money(s.v, 'USD', { compact: true })}</span>`).join('');
  };
  refresh();

  el.oninput = (e) => {
    const t = e.target;
    if (t.dataset.pid) {
      const p = findPerson(t.dataset.pid);
      if (t.dataset.f === 'name') p.name = t.value;
      else p.budget = parseNum(t.value);
    } else if (t.dataset.cid) {
      findCategory(t.dataset.cid).budget = parseNum(t.value);
    } else return;
    save();
    refresh();
  };
  el.onclick = (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'add-person') {
      state.people.push({ id: uid(), name: `Persona ${state.people.length + 1}`, color: PERSON_COLORS[state.people.length % PERSON_COLORS.length], budget: 0 });
      save();
      rerender();
    }
    if (act === 'person') personSheet(t.dataset.id);
    if (act === 'cat') categorySheet(t.dataset.id);
    if (act === 'add-cat') categorySheet();
  };
}

function personSheet(id) {
  const p = findPerson(id);
  let color = p.color;
  openSheet({
    title: p.name,
    body: `
      <div class="label">Color</div>
      <div class="swatches">${PERSON_COLORS.map((c) => `<button type="button" class="swatch ${c === color ? 'on' : ''}" data-c="${c}" style="--c:${c}" aria-label="Color ${c}"></button>`).join('')}</div>`,
    footer: `<button type="button" class="btn danger-ghost" data-del>Eliminar</button><button type="button" class="btn primary grow" data-ok>Listo</button>`,
    onMount(s, close) {
      s.querySelector('.swatches').onclick = (e) => {
        const b = e.target.closest('[data-c]');
        if (!b) return;
        color = b.dataset.c;
        s.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === b));
      };
      s.querySelector('[data-ok]').onclick = () => {
        p.color = color;
        save();
        close();
        rerender();
      };
      s.querySelector('[data-del]').onclick = () => {
        const n = alive().filter((e) => e.personId === id).length;
        if (n) return toast(`No se puede eliminar: tiene ${n} gasto(s)`, 'err');
        if (!confirm(`¿Eliminar a ${p.name}?`)) return;
        state.people = state.people.filter((x) => x.id !== id);
        save();
        close();
        rerender();
      };
    },
  });
}

const ICONS = ['🍽️', '🏨', '🚆', '✈️', '🚕', '🎟️', '👕', '🛍️', '💊', '📦', '☕', '🍺', '🎁', '📱', '⛽', '🏛️'];

function categorySheet(id) {
  const orig = id && findCategory(id);
  const c = orig ? { ...orig, subs: [...orig.subs] } : { name: '', icon: '📦', budget: 0, subs: [] };
  openSheet({
    title: orig ? 'Editar categoría' : 'Nueva categoría',
    body: `
      <div class="field-row">
        <label class="field icon-field"><span>Ícono</span><input name="icon" value="${esc(c.icon)}" maxlength="4"></label>
        <label class="field grow"><span>Nombre</span><input name="name" value="${esc(c.name)}" placeholder="Ej. Comida" autocomplete="off"></label>
      </div>
      <div class="chips wrap small" data-icons>${ICONS.map((i) => `<button type="button" class="chip" data-i="${i}">${i}</button>`).join('')}</div>
      <label class="field"><span>Presupuesto del general (USD)</span><input name="budget" inputmode="decimal" value="${numIn(c.budget)}" placeholder="0"></label>
      <label class="field"><span>Subcategorías (una por línea)</span><textarea name="subs" rows="6" placeholder="Restaurante&#10;Supermercado">${esc(c.subs.join('\n'))}</textarea></label>
      <label class="switch"><input type="checkbox" name="fixed" ${c.fixed ? 'checked' : ''}><span class="track"></span><span>Excluir del promedio diario</span></label>
      <p class="hint">Para gastos fijos como estadía o pasajes, que distorsionan el gasto del día a día.</p>`,
    footer: `${orig ? '<button type="button" class="btn danger-ghost" data-del>Eliminar</button>' : ''}<button type="button" class="btn primary grow" data-ok>Guardar</button>`,
    onMount(s, close) {
      const v = (n) => s.querySelector(`[name="${n}"]`);
      s.querySelector('[data-icons]').onclick = (e) => {
        const b = e.target.closest('[data-i]');
        if (b) v('icon').value = b.dataset.i;
      };
      s.querySelector('[data-ok]').onclick = () => {
        const next = {
          name: v('name').value.trim(),
          icon: v('icon').value.trim() || '📦',
          budget: parseNum(v('budget').value),
          subs: [...new Set(v('subs').value.split('\n').map((x) => x.trim()).filter(Boolean))],
          fixed: v('fixed').checked,
        };
        if (!next.name) return toast('Ponle un nombre a la categoría', 'err');
        if (orig) Object.assign(orig, next);
        else state.categories.push({ id: uid(), ...next });
        save();
        close();
        rerender();
      };
      s.querySelector('[data-del]')?.addEventListener('click', () => {
        const n = alive().filter((e) => e.categoryId === id).length;
        if (n) return toast(`No se puede eliminar: tiene ${n} gasto(s)`, 'err');
        if (!confirm(`¿Eliminar la categoría "${orig.name}"?`)) return;
        state.categories = state.categories.filter((x) => x.id !== id);
        save();
        close();
        rerender();
      });
    },
  });
}

/* ================= LUGARES ================= */

function renderPlaces(el) {
  const spent = groupSum(alive(), (e) => e.placeId || '');
  const places = [...state.places].sort((a, b) => (a.start || '9') < (b.start || '9') ? -1 : 1);
  el.innerHTML = `
    <div class="list">
      ${places.map((p) => {
        const nights = p.start && p.end ? daysBetween(p.start, p.end) : null;
        return `
        <button type="button" class="list-item" data-act="edit" data-id="${p.id}">
          <span class="li-icon">📍</span>
          <span class="li-main">
            <b>${esc(p.name)}${p.country ? ` <span class="muted">· ${esc(p.country)}</span>` : ''}</b>
            <small>${p.start ? `${fmtDate(p.start)}${p.end ? ` – ${fmtDate(p.end)}` : ''}` : 'Sin fechas'}${nights != null ? ` · ${nights} ${nights === 1 ? 'noche' : 'noches'}` : ''}</small>
          </span>
          <span class="li-end"><b>${money(spent.get(p.id) || 0)}</b><small>gastado</small></span>
        </button>`;
      }).join('') || emptyState('Agrega las ciudades o lugares que visitarán. Con fechas, el registro elige el lugar automáticamente.', '🗺️')}
    </div>
    <button type="button" class="btn block soft" data-act="add">＋ Agregar lugar</button>`;
  el.onclick = (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    placeSheet(t.dataset.act === 'edit' ? t.dataset.id : null);
  };
}

function placeSheet(id) {
  const orig = id && findPlace(id);
  const p = orig ? { ...orig } : { name: '', country: '', start: '', end: '' };
  openSheet({
    title: orig ? 'Editar lugar' : 'Nuevo lugar',
    body: `
      <label class="field"><span>Ciudad / lugar</span><input name="name" value="${esc(p.name)}" placeholder="Ej. Madrid" autocomplete="off"></label>
      <label class="field"><span>País (opcional)</span><input name="country" value="${esc(p.country)}" placeholder="Ej. España" autocomplete="off"></label>
      <div class="field-row">
        <label class="field"><span>Desde</span><input type="date" name="start" value="${p.start}"></label>
        <label class="field"><span>Hasta</span><input type="date" name="end" value="${p.end}"></label>
      </div>`,
    footer: `${orig ? '<button type="button" class="btn danger-ghost" data-del>Eliminar</button>' : ''}<button type="button" class="btn primary grow" data-ok>Guardar</button>`,
    onMount(s, close) {
      const v = (n) => s.querySelector(`[name="${n}"]`);
      s.querySelector('[data-ok]').onclick = () => {
        const next = { name: v('name').value.trim(), country: v('country').value.trim(), start: v('start').value, end: v('end').value };
        if (!next.name) return toast('Ponle un nombre al lugar', 'err');
        if (next.start && next.end && next.end < next.start) return toast('La fecha final es anterior a la inicial', 'err');
        if (orig) Object.assign(orig, next);
        else state.places.push({ id: uid(), ...next });
        save();
        close();
        rerender();
      };
      s.querySelector('[data-del]')?.addEventListener('click', () => {
        const n = alive().filter((e) => e.placeId === id).length;
        if (n) return toast(`No se puede eliminar: tiene ${n} gasto(s)`, 'err');
        if (!confirm(`¿Eliminar "${orig.name}"?`)) return;
        state.places = state.places.filter((x) => x.id !== id);
        save();
        close();
        rerender();
      });
    },
  });
}

/* ================= AJUSTES ================= */

function renderSettings(el) {
  const t = state.trip;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const linked = isLinked();
  el.innerHTML = `
    <h3 class="section-title">Compartir con el grupo</h3>
    ${linked ? `
    <div class="card">
      <div class="row-between"><b>Viaje compartido</b><span class="pc" data-sync-status></span></div>
      <p class="hint" data-sync-detail></p>
      <div class="btn-grid" style="margin-top:12px">
        <button type="button" class="btn primary" data-act="share">🔗 Compartir enlace</button>
        <button type="button" class="btn soft" data-act="sync">↻ Sincronizar</button>
      </div>
      <p class="hint">Quien abra el enlace verá y registrará en este mismo viaje. Compártelo solo con el grupo.</p>
    </div>` : `
    <div class="card">
      <p class="small" style="margin-top:0">Ahora los datos solo viven en este teléfono. Para que los 3 vean y registren lo mismo:</p>
      <button type="button" class="btn primary block" data-act="create">✈️ Crear viaje compartido</button>
      <p class="hint" style="margin:0 4px 12px">Sube lo que tienes en este teléfono y te da un enlace para los demás.</p>
      <label class="field"><span>¿Ya te pasaron un enlace?</span><input data-join-input placeholder="Pega el enlace o código" autocomplete="off"></label>
      <button type="button" class="btn soft block" data-act="join">Unirme al viaje</button>
    </div>`}

    <h3 class="section-title">Apariencia</h3>
    <div class="card compact">
      <div class="row-between"><b class="small">Tema</b>
        <div class="mini-seg" data-theme-sel>
          ${[['auto', 'Auto'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([k, l]) => `<button type="button" class="${getTheme() === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}
        </div>
      </div>
    </div>

    <h3 class="section-title">Viaje</h3>
    <div class="card">
      <label class="field"><span>Nombre del viaje</span><input data-trip="name" value="${esc(t.name)}" autocomplete="off"></label>
      <div class="field-row">
        <label class="field"><span>Inicio</span><input type="date" data-trip="start" value="${t.start}"></label>
        <label class="field"><span>Fin</span><input type="date" data-trip="end" value="${t.end}"></label>
      </div>
      <p class="hint">Con las fechas el dashboard calcula cuánto pueden gastar por día.</p>
    </div>

    ${standalone ? '' : `
    <h3 class="section-title">Instalar en el teléfono</h3>
    <div class="card">
      <p class="small"><b>iPhone (Safari):</b> botón Compartir <span class="kbd">⬆︎</span> → <b>Agregar a inicio</b>.</p>
      <p class="small"><b>Android (Chrome):</b> menú <span class="kbd">⋮</span> → <b>Instalar app</b>.</p>
      ${window.__installPrompt ? '<button type="button" class="btn primary block" data-act="install">Instalar ahora</button>' : ''}
    </div>`}

    <h3 class="section-title">Datos</h3>
    <div class="card">
      <div class="btn-grid">
        <button type="button" class="btn soft" data-act="export">⬇︎ Exportar respaldo</button>
        <label class="btn soft">⬆︎ Importar respaldo<input type="file" accept="application/json,.json" data-act="import" hidden></label>
        ${linked ? '' : '<button type="button" class="btn soft" data-act="sample">🧪 Cargar ejemplo</button>'}
        <button type="button" class="btn danger-ghost" data-act="reset">${linked ? '⛓ Desvincular teléfono' : '🗑 Borrar todo'}</button>
      </div>
      <p class="hint">${alive().length} gastos · ${state.accounts.length} cuentas · ${state.places.length} lugares</p>
    </div>`;

  el.oninput = (e) => {
    const k = e.target.dataset.trip;
    if (!k) return;
    state.trip[k] = e.target.value;
    save();
  };
  el.onchange = async (e) => {
    if (e.target.dataset.act !== 'import') return;
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.expenses) || !Array.isArray(data.accounts)) throw new Error('formato');
      const msg = isLinked()
        ? 'Esto reemplaza los datos por los del respaldo y los sube al viaje compartido (lo verán todos). ¿Continuar?'
        : 'Esto reemplaza todos los datos de este teléfono por los del respaldo. ¿Continuar?';
      if (!confirm(msg)) return;
      replaceState(data);
      toast('Respaldo importado');
      refreshApp();
    } catch {
      toast('El archivo no es un respaldo válido', 'err');
    }
  };
  el.onclick = async (e) => {
    const th = e.target.closest('[data-theme-sel] [data-v]');
    if (th) {
      setTheme(th.dataset.v);
      th.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === th));
      return;
    }
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'install' && window.__installPrompt) {
      window.__installPrompt.prompt();
      await window.__installPrompt.userChoice;
      window.__installPrompt = null;
      rerender();
    }
    if (act === 'export') {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `viaje-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    if (act === 'sample') {
      if (state.expenses.length && !confirm('Esto reemplaza tus datos actuales por datos de ejemplo. ¿Continuar?')) return;
      replaceState(sampleState());
      toast('Datos de ejemplo cargados');
      refreshApp();
    }
    if (act === 'reset') {
      const wasLinked = isLinked();
      if (wasLinked) {
        if (!confirm('¿Desvincular este teléfono del viaje compartido? Los datos se borran solo de este teléfono; el viaje sigue intacto para los demás y puedes volver a unirte con el enlace.')) return;
        unlink();
      } else if (!confirm('¿Borrar TODOS los datos de este teléfono? No se puede deshacer.')) return;
      replaceState(freshState());
      toast(wasLinked ? 'Teléfono desvinculado' : 'Datos borrados');
      refreshApp();
    }
    if (act === 'create') {
      t.disabled = true;
      try {
        await createShared();
        toast('Viaje compartido creado', 'ok');
        rerender();
        shareTrip();
      } catch (err) {
        unlink();
        toast('No se pudo crear: revisa la conexión', 'err');
        t.disabled = false;
      }
    }
    if (act === 'join') {
      const id = parseTripId(el.querySelector('[data-join-input]').value);
      if (!id) return toast('Ese enlace no parece válido', 'err');
      joinFlow(id);
    }
    if (act === 'share') shareTrip();
    if (act === 'sync') syncNow();
  };
  paintSync();
}

/** Une este teléfono a un viaje (desde el enlace o el campo de Ajustes). */
export async function joinFlow(id) {
  if (isLinked() && tripId() === id) return;
  const n = alive().length;
  const warn = isLinked()
    ? '¿Cambiar a otro viaje compartido? Los datos de este teléfono se reemplazan por los del nuevo viaje.'
    : n
      ? `Este teléfono tiene ${n} gasto(s) que no están compartidos y se reemplazarán por los del viaje. ¿Unirte?`
      : '¿Unirte a este viaje compartido?';
  if (!confirm(warn)) return;
  try {
    toast('Uniéndote al viaje…');
    await joinTrip(id);
    toast('¡Listo! Ya estás en el viaje', 'ok');
    refreshApp();
  } catch (err) {
    toast(err.message || 'No se pudo unir', 'err');
  }
}

async function shareTrip() {
  const url = shareUrl();
  const text = `Únete a "${state.trip.name}" para llevar el presupuesto del viaje:`;
  try {
    if (navigator.share) return await navigator.share({ title: state.trip.name, text, url });
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Enlace copiado', 'ok');
  } catch {
    prompt('Copia este enlace y compártelo:', url);
  }
}

const STATUS_TXT = {
  ok: ['Sincronizado', 'good'], syncing: ['Sincronizando…', ''], pending: ['Pendiente', ''], idle: ['Pendiente', ''],
  offline: ['Sin conexión', 'bad'], error: ['Error', 'bad'], local: ['Local', ''],
};
function paintSync() {
  const pill = root?.querySelector('[data-sync-status]');
  if (!pill) return;
  const info = syncInfo();
  const [txt, cls] = STATUS_TXT[info.status] || STATUS_TXT.idle;
  pill.textContent = txt;
  pill.className = `pc ${cls}`;
  const ago = info.lastSync ? Math.round((Date.now() - info.lastSync) / 60000) : null;
  root.querySelector('[data-sync-detail]').textContent =
    (ago == null ? 'Aún no se ha sincronizado' : ago < 1 ? 'Última sincronización: hace un momento' : `Última sincronización: hace ${ago} min`) +
    (info.pending ? ` · ${info.pending} cambio(s) por subir` : '') +
    (info.status === 'error' ? ` · ${info.error.slice(0, 80)}` : '');
}
onSync(paintSync);
