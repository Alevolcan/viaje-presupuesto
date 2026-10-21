// Tasa EUR→USD. Fuente principal: Frankfurter (tasas de referencia del BCE,
// gratis y sin API key). Respaldo: open.er-api.com. Se cachea por fecha para
// funcionar offline y no repetir llamadas.
import { todayISO } from './store.js';

const KEY = 'viaje:fx';
const LATEST_TTL = 3 * 3600e3;

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
function writeCache(k, v) {
  const c = readCache();
  c[k] = v;
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {}
}

export function lastKnownRate() {
  let best = null;
  for (const v of Object.values(readCache())) if (!best || v.fetchedAt > best.fetchedAt) best = v;
  return best;
}

async function getJSON(url, ms = 7000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** Devuelve { rate, date, source, stale?, approx? } para 1 EUR en USD. */
export async function eurToUsd(date) {
  const historical = !!date && date < todayISO();
  const key = historical ? date : 'latest';
  const cached = readCache()[key];
  if (cached && (historical || Date.now() - cached.fetchedAt < LATEST_TTL)) return cached;

  const path = historical ? date : 'latest';
  const sources = [
    async () => {
      const j = await getJSON(`https://api.frankfurter.dev/v1/${path}?base=EUR&symbols=USD`);
      return { rate: j.rates.USD, date: j.date, source: 'BCE' };
    },
    async () => {
      const j = await getJSON(`https://api.frankfurter.app/${path}?from=EUR&to=USD`);
      return { rate: j.rates.USD, date: j.date, source: 'BCE' };
    },
    async () => {
      const j = await getJSON('https://open.er-api.com/v6/latest/EUR');
      if (j.result !== 'success') throw new Error('er-api');
      const d = new Date(j.time_last_update_utc).toISOString().slice(0, 10);
      return { rate: j.rates.USD, date: d, source: 'ER-API', approx: historical };
    },
  ];
  for (const src of sources) {
    try {
      const r = await src();
      if (r.rate > 0) {
        const v = { ...r, fetchedAt: Date.now() };
        if (!r.approx) writeCache(key, v);
        return v;
      }
    } catch {}
  }
  const fallback = cached || lastKnownRate();
  if (fallback) return { ...fallback, stale: true };
  throw new Error('Sin conexión para obtener la tasa');
}
