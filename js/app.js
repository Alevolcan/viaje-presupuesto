import { state, onChange, todayISO } from './store.js';
import { daysBetween, syncThemeColor, initSegmented } from './ui.js';
import * as presupuesto from './views/budget.js';
import * as registro from './views/register.js';
import * as dashboard from './views/dashboard.js';
import { joinFlow } from './views/budget.js';
import { initSync, onSync, syncInfo, parseTripId } from './sync.js';

const VIEWS = { presupuesto, registro, dashboard };
const viewEl = document.getElementById('view');
const titleEl = document.getElementById('title');
let current = null;

function subtitle() {
  const t = state.trip;
  let s = t.name || '';
  if (t.start && t.end) {
    const today = todayISO();
    const total = daysBetween(t.start, t.end) + 1;
    if (today < t.start) s += ` · faltan ${daysBetween(today, t.start)} días`;
    else if (today > t.end) s += ' · viaje terminado';
    else s += ` · día ${daysBetween(t.start, today) + 1} de ${total}`;
  }
  document.getElementById('subtitle').textContent = s;
}

/** Pastilla de la barra inferior que se desliza a la pestaña activa. */
function moveTabIndicator(instant = false) {
  const on = document.querySelector('.tabbar a.on');
  const ind = document.querySelector('.tab-ind');
  if (!on || !ind) return;
  // Primera colocación (y al cambiar el tamaño) sin transición: solo se desliza al cambiar de pestaña.
  ind.classList.toggle('instant', instant || !ind.style.width);
  ind.style.width = `${on.offsetWidth}px`;
  ind.style.transform = `translateX(${on.offsetLeft}px)`;
  void ind.offsetWidth;
  ind.classList.remove('instant');
}

function route() {
  let name = location.hash.slice(1);
  if (!VIEWS[name]) name = state.accounts.length ? 'registro' : 'presupuesto';
  const changed = name !== current;
  current = name;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
  moveTabIndicator();
  if (changed) {
    titleEl.textContent = VIEWS[name].title;
    titleEl.classList.remove('swap');
    void titleEl.offsetWidth;
    titleEl.classList.add('swap');
    window.scrollTo(0, 0);
  }
  subtitle();
  VIEWS[name].render(viewEl, 'enter');
}

window.addEventListener('hashchange', route);
window.addEventListener('app:refresh', () => {
  current = null;
  route();
});

// Llegaron cambios de otro teléfono: redibuja sin interrumpir si se está escribiendo en un campo.
let remotePending = false;
const typing = () => viewEl.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
function applyRemote() {
  if (typing()) return void (remotePending = true);
  remotePending = false;
  const y = window.scrollY;
  VIEWS[current]?.render(viewEl, 'soft');
  window.scrollTo(0, y);
}
window.addEventListener('app:remote', applyRemote);
viewEl.addEventListener('focusout', () => remotePending && setTimeout(() => remotePending && applyRemote(), 50));

// Punto del encabezado = estado de la sincronización.
const subEl = document.getElementById('subtitle');
onSync(() => {
  const s = syncInfo().status;
  subEl.dataset.sync = s;
  subEl.title = { ok: 'Sincronizado', pending: 'Cambios por subir', syncing: 'Sincronizando', offline: 'Sin conexión', error: 'Error al sincronizar' }[s] || '';
});
window.addEventListener('resize', () => moveTabIndicator(true));
onChange(subtitle);
syncThemeColor();

// Enlace de invitación: ?viaje=<id> une este teléfono al viaje compartido.
const invite = parseTripId(new URLSearchParams(location.search).get('viaje'));
if (invite) {
  history.replaceState(null, '', location.pathname + (location.hash || '#registro'));
  setTimeout(() => joinFlow(invite), 400);
}
route();
initSync();
// La fuente web cambia el ancho de las pestañas: reubica las pastillas al cargarla.
document.fonts?.ready.then(() => {
  moveTabIndicator(true);
  initSegmented(viewEl);
});

// Al volver a la app (p. ej. al día siguiente) refresca fechas y totales.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && current === 'dashboard') VIEWS.dashboard.render(viewEl, 'soft');
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncThemeColor);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installPrompt = e;
});

if ('serviceWorker' in navigator && (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.search.includes('sw=1'))) {
  navigator.serviceWorker.register('sw.js');
}
