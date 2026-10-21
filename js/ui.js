// Helpers de interfaz: formato, escape, hojas (bottom sheets) y toasts.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: 'always' });
const nf4 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export function money(n, cur = 'USD', { compact = false } = {}) {
  const sym = cur === 'EUR' ? '€' : '$';
  const v = Number(n) || 0;
  const a = Math.abs(v);
  let s;
  if (compact && a >= 10000) s = nf0.format(a / 1000) + 'k';
  else if (compact && a >= 1000) s = (a / 1000).toFixed(1).replace('.', ',') + 'k';
  else if (compact) s = nf0.format(a);
  else s = nf2.format(a);
  return (v < 0 ? '−' : '') + sym + s;
}

export const rateFmt = (n) => nf4.format(n || 0);
export const pct = (n) => `${Math.round((n || 0) * 100)}%`;

/** Acepta "1.234,56", "1,234.56", "12,5" o "12.5". */
export function parseNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v ?? '').trim().replace(/\s/g, '').replace(/[€$]/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

/** Valor para un <input> numérico editable (vacío si es 0). */
export const numIn = (n) => (n ? String(n).replace('.', ',') : '');

const dShort = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dLong = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const toUTC = (iso) => new Date(iso + 'T00:00:00Z');
export const fmtDate = (iso) => (iso ? dShort.format(toUTC(iso)).replace('.', '') : '');
export const fmtDay = (iso) => (iso ? dLong.format(toUTC(iso)).replace(/\./g, '') : '');
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
export function addDays(iso, n) {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function emptyState(text, icon = '🧳') {
  return `<div class="empty"><div class="empty-icon">${icon}</div><p>${text}</p></div>`;
}

/* ---------- Animaciones ---------- */
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ANIM_SEL = '.segmented, .hero, .card, .list, .section-title, .group, .field, .field-row, .filters, .btn.block, .search, .day-head, .empty, .edit-banner, .sticky-actions, .btn-grid';

/**
 * Entrada de una vista: bloques que suben escalonados, barras que crecen, anillo que se llena y
 * cifras que cuentan. mode 'soft' (cambio de filtro) omite el escalonado de bloques.
 */
export function animateIn(el, mode = 'enter') {
  el.classList.remove('enter', 'soft');
  if (mode === 'enter') {
    let i = 0;
    for (const n of el.querySelectorAll(ANIM_SEL)) {
      if (n.parentElement.closest('.anim')) continue;
      n.classList.add('anim');
      n.style.setProperty('--i', Math.min(i++, 12));
    }
  }
  el.querySelectorAll('.day-col').forEach((d, k) => d.style.setProperty('--d', k));
  void el.offsetWidth;
  el.classList.add(mode);
  clearTimeout(el._animT);
  el._animT = setTimeout(() => {
    el.classList.remove('enter', 'soft');
    el.querySelectorAll('.anim').forEach((n) => n.classList.remove('anim'));
  }, 1800);
  countUp(el);
  initSegmented(el);
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
/** Anima de 0 al valor los elementos con data-count (y data-cur / data-fmt="int"). */
export function countUp(root) {
  for (const n of root.querySelectorAll('[data-count]')) {
    const to = Number(n.dataset.count) || 0;
    const fmt = (v) => (n.dataset.fmt === 'int' ? String(Math.round(v)) : money(v, n.dataset.cur || 'USD'));
    if (reduced() || !to || document.hidden) { n.textContent = fmt(to); continue; }
    const t0 = performance.now();
    const dur = 900;
    let done = false;
    const step = () => {
      if (done) return;
      // Reloj real (no el sello del cuadro, que puede ir atrasado o ser anterior a t0).
      const p = Math.min(1, Math.max(0, (performance.now() - t0) / dur));
      n.textContent = fmt(to * easeOut(p));
      if (p < 1) requestAnimationFrame(step);
      else done = true;
    };
    n.textContent = fmt(0);
    requestAnimationFrame(step);
    // Si el navegador pausa los cuadros (pestaña en segundo plano), igual deja la cifra final.
    setTimeout(() => { if (!done) { done = true; n.textContent = fmt(to); } }, dur + 200);
  }
}

/** Pastilla que se desliza bajo la opción activa de cada .segmented. */
export function initSegmented(root) {
  for (const seg of root.querySelectorAll('.segmented')) {
    let ind = seg.querySelector('.seg-ind');
    if (!ind) {
      ind = document.createElement('span');
      ind.className = 'seg-ind';
      seg.prepend(ind);
    }
    const on = seg.querySelector('button.on');
    if (!on) continue;
    ind.classList.add('instant');
    seg.classList.add('ready');
    ind.style.width = `${on.offsetWidth}px`;
    ind.style.transform = `translateX(${on.offsetLeft}px)`;
    void ind.offsetWidth;
    ind.classList.remove('instant');
  }
}

/** Mueve la pastilla del segmentado a `btn` antes de re-dibujar (efecto de deslizamiento). */
export function slideSegment(btn) {
  const seg = btn.closest('.segmented');
  const ind = seg?.querySelector('.seg-ind');
  if (!ind) return;
  seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
  ind.style.width = `${btn.offsetWidth}px`;
  ind.style.transform = `translateX(${btn.offsetLeft}px)`;
}

/* ---------- Tema ---------- */
export const getTheme = () => {
  try { return localStorage.getItem('viaje:theme') || 'auto'; } catch { return 'auto'; }
};
export function setTheme(t) {
  try { localStorage.setItem('viaje:theme', t); } catch {}
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  syncThemeColor();
}
export function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#F3F4F7');
}

/* ---------- Bottom sheet ---------- */
export function openSheet({ title, body, footer = '', onMount }) {
  const root = document.getElementById('sheet-root');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grab"></div>
      <header class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Cerrar">✕</button></header>
      <div class="sheet-body">${body}</div>
      ${footer ? `<footer class="sheet-foot">${footer}</footer>` : ''}
    </section>`;
  root.appendChild(wrap);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.add('closing');
    wrap.classList.remove('open');
    if (root.children.length <= 1) document.body.classList.remove('no-scroll');
    setTimeout(() => wrap.remove(), 260);
  };
  wrap.querySelector('.sheet-backdrop').addEventListener('click', close);
  wrap.querySelector('[data-close]').addEventListener('click', close);
  const sheet = wrap.querySelector('.sheet');
  onMount?.(sheet, close);
  return { el: sheet, close };
}

let toastTimer;
export function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/** Pide a la app que vuelva a dibujar la vista actual (p. ej. tras importar datos). */
export const refreshApp = () => window.dispatchEvent(new Event('app:refresh'));

export const vibrate = (ms = 12) => navigator.vibrate?.(ms);
