// Cálculos de presupuesto y comisiones.
import { state } from './store.js';

export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (+f(x) || 0), 0);
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const alive = () => state.expenses.filter((e) => !e.deleted);

export const feeApplies = (acc, currency) => !!acc && (!acc.feeOnlyForeign || currency !== 'USD');
export const hasFee = (acc) => !!acc && ((acc.feePct || 0) > 0 || (acc.feeFixed || 0) > 0);

/** Convierte a USD y suma la comisión de la cuenta. */
export function computeCharge({ amount, currency, rate, account }) {
  const amountUsd = round2(currency === 'USD' ? amount : amount * (rate || 0));
  let feeUsd = 0;
  if (amount > 0 && feeApplies(account, currency)) {
    feeUsd = round2((amountUsd * (account.feePct || 0)) / 100 + (account.feeFixed || 0));
  }
  return { amountUsd, feeUsd, totalUsd: round2(amountUsd + feeUsd) };
}

export function budgetSummary() {
  const total = sum(state.accounts, (a) => a.balance);
  const personal = sum(state.people, (p) => p.budget);
  const general = total - personal;
  const assigned = sum(state.categories, (c) => c.budget);
  return { total, personal, general, assigned, unassigned: general - assigned };
}

/** Gastos del día a día: excluye categorías marcadas como fijas (estadía, pasajes). */
export function isDaily(e) {
  return !state.categories.find((c) => c.id === e.categoryId)?.fixed;
}

export function groupSum(exps, keyFn) {
  const m = new Map();
  for (const e of exps) {
    const k = keyFn(e);
    m.set(k, (m.get(k) || 0) + e.totalUsd);
  }
  return m;
}

export function placeForDate(date) {
  if (!date) return '';
  const p =
    state.places.find((p) => p.start && p.end && date >= p.start && date <= p.end) ||
    state.places.find((p) => p.start && !p.end && date >= p.start);
  return p?.id || '';
}
