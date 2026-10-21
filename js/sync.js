// Sincronización con Supabase entre los teléfonos del viaje.
//
// - Cada viaje compartido tiene un id (uuid) que funciona como enlace secreto: se envía en el
//   header x-trip-id y las políticas RLS solo dejan leer/escribir ese viaje.
// - La configuración (viaje, personas, cuentas, categorías, lugares) es un documento por viaje:
//   gana la última escritura.
// - Cada gasto es una fila; gana la versión con updatedAt más reciente. Los borrados son lógicos.
// - Funciona sin conexión: lo pendiente se sube cuando vuelve la señal.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { state, save, onChange, freshState, replaceState } from './store.js';

const META_KEY = 'viaje:sync';
const CONFIG_KEYS = ['trip', 'people', 'accounts', 'categories', 'places'];
const PULL_OVERLAP_MS = 5000;

const blankMeta = () => ({ tripId: null, configAt: null, configSent: null, lastPull: null, pushed: {}, lastSync: null });
let meta = loadMeta();
let status = meta.tripId ? 'idle' : 'local'; // local | idle | syncing | ok | pending | offline | error
let lastError = '';
let running = null;
let again = false;
let applying = false;
let timer = null;
const listeners = new Set();

function loadMeta() {
  try {
    return { ...blankMeta(), ...JSON.parse(localStorage.getItem(META_KEY)) };
  } catch {
    return blankMeta();
  }
}
function saveMeta() {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {}
}
function setStatus(s, err = '') {
  status = s;
  lastError = err;
  listeners.forEach((f) => f());
}

export const onSync = (f) => (listeners.add(f), () => listeners.delete(f));
export const tripId = () => meta.tripId;
export const isLinked = () => !!meta.tripId;
export const shareUrl = () => `${location.origin}${location.pathname}?viaje=${meta.tripId}`;
export function syncInfo() {
  return { status, error: lastError, lastSync: meta.lastSync, pending: pendingExpenses().length + (configDirty() ? 1 : 0) };
}

const configOf = (s) => JSON.stringify(Object.fromEntries(CONFIG_KEYS.map((k) => [k, s[k]])));
const configDirty = () => !!meta.tripId && configOf(state) !== meta.configSent;
const pendingExpenses = () => (meta.tripId ? state.expenses.filter((e) => meta.pushed[e.id] !== e.updatedAt) : []);

/* ---------- REST ---------- */
async function api(path, { method = 'GET', body, tid = meta.tripId, prefer } = {}) {
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', 'x-trip-id': tid };
  if (SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_KEY}`;
  if (prefer) headers.Prefer = prefer;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body && JSON.stringify(body), signal: ctl.signal, cache: 'no-store' });
    const text = await r.text();
    if (!r.ok) throw Object.assign(new Error(`${r.status} ${text}`), { http: r.status });
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(t);
  }
}
const UPSERT = 'resolution=merge-duplicates,return=minimal';

async function fetchTrip(tid) {
  const rows = await api(`travel_trips?id=eq.${tid}&select=data,updated_at`, { tid });
  return rows?.[0] || null;
}
async function fetchExpenses(tid, since) {
  const all = [];
  const filter = since ? `&updated_at=gt.${encodeURIComponent(since)}` : '';
  for (let from = 0; ; from += 1000) {
    const rows = await api(`travel_expenses?trip_id=eq.${tid}${filter}&select=id,data,deleted,updated_at&order=updated_at.asc&offset=${from}&limit=1000`, { tid });
    all.push(...rows);
    if (rows.length < 1000) return all;
  }
}

/* ---------- Fusión ---------- */
function mergeExpenses(rows) {
  let changed = false;
  for (const row of rows) {
    const remote = { ...row.data, id: row.id, deleted: row.deleted };
    const i = state.expenses.findIndex((e) => e.id === row.id);
    const local = i >= 0 ? state.expenses[i] : null;
    if (!local || (remote.updatedAt || 0) > (local.updatedAt || 0)) {
      if (local) state.expenses[i] = remote;
      else state.expenses.push(remote);
      meta.pushed[row.id] = remote.updatedAt;
      changed = true;
    } else if ((remote.updatedAt || 0) === (local.updatedAt || 0)) {
      meta.pushed[row.id] = local.updatedAt;
    }
    if (!meta.lastPull || row.updated_at > meta.lastPull) meta.lastPull = row.updated_at;
  }
  return changed;
}

function applyConfig(data) {
  for (const k of CONFIG_KEYS) if (data[k] != null) state[k] = data[k];
  meta.configSent = configOf(state);
}

/** Guarda en local sin que la propia escritura dispare otra sincronización. */
function commitLocal() {
  applying = true;
  try {
    save();
  } finally {
    applying = false;
  }
  window.dispatchEvent(new Event('app:remote'));
}

/* ---------- Ciclo ---------- */
async function cycle() {
  const tid = meta.tripId;
  let changed = false;

  // 1) Configuración: si cambió en el servidor y aquí no, se baja; si cambió aquí, se sube.
  const remote = await fetchTrip(tid);
  if (remote && remote.updated_at !== meta.configAt && !configDirty()) {
    applyConfig(remote.data);
    meta.configAt = remote.updated_at;
    changed = true;
  }
  if (!remote || configDirty()) {
    const sent = configOf(state);
    await api('travel_trips', { method: 'POST', body: [{ id: tid, data: JSON.parse(sent) }], prefer: UPSERT });
    meta.configSent = sent;
    meta.configAt = (await fetchTrip(tid))?.updated_at || meta.configAt;
  }

  // 2) Gastos pendientes de este teléfono.
  const pending = pendingExpenses();
  for (let i = 0; i < pending.length; i += 200) {
    const batch = pending.slice(i, i + 200);
    const body = batch.map(({ id, deleted, ...data }) => ({ id, trip_id: tid, data, deleted: !!deleted }));
    await api('travel_expenses', { method: 'POST', body, prefer: UPSERT });
    batch.forEach((e) => (meta.pushed[e.id] = e.updatedAt));
  }

  // 3) Gastos nuevos o editados por los demás (con un pequeño solape por si hubo escrituras simultáneas).
  const since = meta.lastPull ? new Date(new Date(meta.lastPull).getTime() - PULL_OVERLAP_MS).toISOString() : null;
  if (mergeExpenses(await fetchExpenses(tid, since))) changed = true;

  meta.lastSync = Date.now();
  saveMeta();
  if (changed) commitLocal();
}

export async function syncNow() {
  if (!meta.tripId) return;
  if (running) {
    again = true;
    return running;
  }
  if (!navigator.onLine) {
    setStatus(pendingExpenses().length || configDirty() ? 'offline' : 'ok');
    return;
  }
  setStatus('syncing');
  running = (async () => {
    try {
      do {
        again = false;
        await cycle();
      } while (again);
      setStatus(pendingExpenses().length || configDirty() ? 'pending' : 'ok');
    } catch (e) {
      console.warn('Sincronización', e);
      setStatus(e.name === 'AbortError' || e instanceof TypeError ? 'offline' : 'error', e.message);
    } finally {
      saveMeta();
      running = null;
    }
  })();
  return running;
}

const schedule = (ms = 1200) => {
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
};

/* ---------- Vincular / desvincular ---------- */

/** Convierte los datos de este teléfono en un viaje compartido nuevo. */
export async function createShared() {
  meta = { ...blankMeta(), tripId: crypto.randomUUID() };
  saveMeta();
  await syncNow();
  if (status === 'error' || status === 'offline') throw new Error(lastError || 'Sin conexión');
}

/** Se une a un viaje existente: reemplaza los datos de este teléfono por los del viaje. */
export async function joinTrip(tid) {
  const trip = await fetchTrip(tid);
  if (!trip) throw new Error('No encontré ese viaje. Revisa el enlace.');
  const rows = await fetchExpenses(tid, null);
  const prefs = state.prefs;
  meta = { ...blankMeta(), tripId: tid };
  const next = { ...freshState(), prefs };
  applying = true;
  try {
    replaceState(next);
    applyConfig(trip.data);
    meta.configAt = trip.updated_at;
    mergeExpenses(rows);
    save();
  } finally {
    applying = false;
  }
  meta.lastSync = Date.now();
  saveMeta();
  setStatus('ok');
}

export function unlink() {
  meta = blankMeta();
  saveMeta();
  setStatus('local');
}

/** Extrae el id del viaje de un enlace o código pegado. */
export function parseTripId(text) {
  const m = String(text || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0].toLowerCase() : null;
}

/* ---------- Arranque ---------- */
export function initSync() {
  onChange(() => {
    if (!applying && meta.tripId) {
      if (status === 'ok') setStatus('pending');
      schedule();
    }
  });
  window.addEventListener('online', () => schedule(300));
  window.addEventListener('offline', () => meta.tripId && setStatus('offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(300);
  });
  setInterval(() => document.visibilityState === 'visible' && syncNow(), 30000);
  if (meta.tripId) schedule(200);
}
