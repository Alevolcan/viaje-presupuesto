// Estado de la app. Hoy vive en localStorage (local-first); más adelante se
// sincroniza con Supabase. Cada gasto lleva id, createdAt/updatedAt y borrado
// lógico (deleted) para poder fusionar cambios entre teléfonos.

const KEY = 'viaje:v1';
export const GENERAL = 'general';
export const PERSON_COLORS = ['#0ea5e9', '#f97316', '#a855f7', '#22c55e', '#ef4444', '#eab308', '#14b8a6', '#ec4899'];

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function defaultCategories() {
  return [
    { name: 'Comida', icon: '🍽️', subs: ['Restaurante', 'Supermercado', 'Café', 'Snacks', 'Bebidas'] },
    { name: 'Alojamiento', icon: '🏨', fixed: true, subs: ['Hotel', 'Airbnb', 'Hostal'] },
    { name: 'Pasajes', icon: '✈️', fixed: true, subs: ['Vuelo', 'Tren', 'Bus', 'Ferry'] },
    { name: 'Transporte local', icon: '🚇', subs: ['Metro', 'Taxi / Uber', 'Bus urbano', 'Alquiler de auto', 'Gasolina', 'Estacionamiento'] },
    { name: 'Entradas', icon: '🎟️', subs: ['Museo', 'Tour', 'Atracción', 'Espectáculo', 'Parque'] },
    { name: 'Ropa', icon: '👕', subs: ['Ropa', 'Calzado', 'Accesorios'] },
    { name: 'Compras', icon: '🛍️', subs: ['Souvenirs', 'Regalos', 'Electrónica', 'Cosméticos'] },
    { name: 'Salud', icon: '💊', subs: ['Farmacia', 'Seguro'] },
    { name: 'Otros', icon: '📦', subs: ['Propinas', 'SIM / Internet', 'Lavandería', 'Varios'] },
  ].map((c) => ({ id: uid(), budget: 0, ...c }));
}

export function freshState() {
  return {
    v: 1,
    trip: { name: 'Nuestro viaje', start: '', end: '' },
    people: ['Persona 1', 'Persona 2', 'Persona 3'].map((name, i) => ({ id: uid(), name, color: PERSON_COLORS[i], budget: 0 })),
    accounts: [],
    categories: defaultCategories(),
    places: [],
    expenses: [],
    prefs: {},
    updatedAt: Date.now(),
  };
}

function normalize(s) {
  const f = freshState();
  if (!s || typeof s !== 'object') return f;
  for (const k of Object.keys(f)) if (s[k] == null) s[k] = f[k];
  s.trip = { ...f.trip, ...s.trip };
  // Datos previos a "fixed": marca estadía y pasajes como gastos fijos.
  if (!s.categories.some((c) => 'fixed' in c)) {
    s.categories.forEach((c) => (c.fixed = /alojamiento|estad|pasaje|vuelo/i.test(c.name)));
  }
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    console.error('No se pudo leer el estado', e);
  }
  return freshState();
}

export const state = load();

const listeners = new Set();
export function save() {
  state.updatedAt = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('No se pudo guardar', e);
  }
  listeners.forEach((f) => f());
}
export const onChange = (f) => (listeners.add(f), () => listeners.delete(f));

export function replaceState(next) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, normalize(next));
  save();
}

export const findPerson = (id) => state.people.find((p) => p.id === id);
export const findAccount = (id) => state.accounts.find((a) => a.id === id);
export const findCategory = (id) => state.categories.find((c) => c.id === id);
export const findPlace = (id) => state.places.find((p) => p.id === id);
