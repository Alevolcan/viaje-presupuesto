// Datos de ejemplo para probar la app (Ajustes → Cargar ejemplo).
import { freshState, uid, todayISO, GENERAL } from './store.js';
import { computeCharge } from './calc.js';
import { addDays } from './ui.js';

export function sampleState() {
  const s = freshState();
  const today = todayISO();
  const start = addDays(today, -6);
  const end = addDays(today, 8);
  s.trip = { name: 'Europa 2026', start, end };

  const names = ['Ana', 'Luis', 'Sofía'];
  s.people.forEach((p, i) => { p.name = names[i]; p.budget = 600; });

  s.accounts = [
    { id: uid(), name: 'Visa Banco A', balance: 4000, feePct: 3, feeFixed: 0, feeOnlyForeign: true },
    { id: uid(), name: 'Mastercard B', balance: 2500, feePct: 1.5, feeFixed: 0.5, feeOnlyForeign: true },
    { id: uid(), name: 'Efectivo', balance: 1000, feePct: 0, feeFixed: 0, feeOnlyForeign: true },
  ];

  const budgets = { Comida: 1300, Alojamiento: 2200, Pasajes: 600, 'Transporte local': 300, Entradas: 500, Ropa: 150, Compras: 150, Salud: 50, Otros: 150 };
  s.categories.forEach((c) => (c.budget = budgets[c.name] || 0));

  s.places = [
    { id: uid(), name: 'Madrid', country: 'España', start, end: addDays(start, 4) },
    { id: uid(), name: 'París', country: 'Francia', start: addDays(start, 4), end: addDays(start, 9) },
    { id: uid(), name: 'Roma', country: 'Italia', start: addDays(start, 9), end },
  ];

  const cat = (n) => s.categories.find((c) => c.name === n);
  const placeAt = (d) => [...s.places].reverse().find((p) => d >= p.start)?.id || '';
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const merchants = {
    Comida: ['Mercado San Miguel', 'Café de Flore', 'Carrefour', 'Trattoria Da Enzo', 'Starbucks', 'Pizzería Roma'],
    'Transporte local': ['Metro', 'Uber', 'Cabify', 'ATAC'],
    Entradas: ['Museo del Prado', 'Louvre', 'Torre Eiffel', 'Coliseo'],
    Ropa: ['Zara', 'Mango'],
    Compras: ['Tienda de souvenirs', 'Galeries Lafayette'],
    Otros: ['Lavandería', 'Vodafone'],
  };
  const rate = 1.08;
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const n = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const cname = pick(['Comida', 'Comida', 'Comida', 'Transporte local', 'Entradas', 'Ropa', 'Compras', 'Otros']);
      const c = cat(cname);
      const personal = rnd() < 0.3;
      const acc = pick(s.accounts);
      const currency = rnd() < 0.85 ? 'EUR' : 'USD';
      const amount = Math.round((5 + rnd() * (cname === 'Ropa' ? 80 : 60)) * 100) / 100;
      const r = currency === 'EUR' ? rate : 1;
      const ch = computeCharge({ amount, currency, rate: r, account: acc });
      s.expenses.push({
        id: uid(), createdAt: Date.now(), updatedAt: Date.now(), date: d, accountId: acc.id, currency, amount, rate: r, ...ch,
        feePct: acc.feePct, personId: personal ? pick(s.people).id : GENERAL, merchant: pick(merchants[cname] || ['']),
        categoryId: c.id, sub: pick(c.subs), placeId: placeAt(d), note: '',
      });
    }
  }
  // Alojamiento y vuelos pagados por adelantado.
  const hotel = cat('Alojamiento');
  s.places.forEach((p, i) => {
    const amount = [620, 780, 540][i];
    const acc = s.accounts[0];
    const ch = computeCharge({ amount, currency: 'EUR', rate, account: acc });
    s.expenses.push({ id: uid(), createdAt: Date.now(), updatedAt: Date.now(), date: start, accountId: acc.id, currency: 'EUR', amount, rate, ...ch, feePct: acc.feePct, personId: GENERAL, merchant: `Hotel ${p.name}`, categoryId: hotel.id, sub: 'Hotel', placeId: p.id, note: '' });
  });
  const pasajes = cat('Pasajes');
  [['Tren', 'Renfe/SNCF Madrid–París', 165, 4], ['Vuelo', 'Vueling París–Roma', 210, 9]].forEach(([sub, merchant, amount, offset]) => {
    const acc = s.accounts[1];
    const ch = computeCharge({ amount, currency: 'EUR', rate, account: acc });
    const d = addDays(start, offset) <= today ? addDays(start, offset) : start;
    s.expenses.push({ id: uid(), createdAt: Date.now(), updatedAt: Date.now(), date: d, accountId: acc.id, currency: 'EUR', amount, rate, ...ch, feePct: acc.feePct, personId: GENERAL, merchant, categoryId: pasajes.id, sub, placeId: placeAt(d), note: '' });
  });
  return s;
}
