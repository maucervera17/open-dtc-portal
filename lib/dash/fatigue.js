import { shift } from '../dates.js';
import { readDashMetrics, readObjectiveMetrics } from './metrics.js';

// Thresholds live here and nowhere else. Both windows must pass every gate before any signal counts.
export const FATIGUE = Object.freeze({
  MIN_IMPRESSIONS: 3000,
  MIN_SPEND: 300,
  MIN_PURCHASES: 3,
  CTR_FACTOR: 0.8,
  CPA_FACTOR: 1.3,
});

// SIGNALS is the neutral "gated, but not all three signals" state (UI label "Vigilar").
// WATCH stays reserved for the agent action (Amendment 3).
export const STATES = Object.freeze({
  INSUFFICIENT_SAMPLE: 'INSUFFICIENT_SAMPLE',
  FATIGUED: 'FATIGUED',
  SIGNALS: 'SIGNALS',
  OK: 'OK',
});

// Closed days only: the current window C ends at D-3, the baseline B is the 7 days before it.
export const windowsFor = D => ({
  C: { from: shift(D, -9), to: shift(D, -3) },
  B: { from: shift(D, -16), to: shift(D, -10) },
});

const finite = v => typeof v === 'number' && Number.isFinite(v);
const numeric = v => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// One insights row for a whole window. Frequency is Meta's own windowed value (unique reach), never a sum of days.
export function statsOf(row) {
  if (!row) return null;
  const m = readDashMetrics(row);
  return { impressions: m.impressions, spend: m.spend, content: m.content, carts: m.carts, checkout: m.checkout, purchases: m.purchases, revenue: m.revenue, content_all: m.content_all, carts_all: m.carts_all, checkout_all: m.checkout_all, frequency: numeric(row.frequency), ctr: m.ctr, cpa: m.cpa, ...readObjectiveMetrics(row) };
}

const passes = w => Boolean(w)
  && finite(w.impressions) && w.impressions >= FATIGUE.MIN_IMPRESSIONS
  && finite(w.spend) && w.spend >= FATIGUE.MIN_SPEND
  && finite(w.purchases) && w.purchases >= FATIGUE.MIN_PURCHASES;

// C: current window stats, B: baseline stats (or null when the ad had no rows there).
export function evaluate(C, B) {
  const gates = { C: passes(C), B: passes(B) };
  if (!gates.C || !gates.B) return { state: STATES.INSUFFICIENT_SAMPLE, signals: null, gates };
  const signals = {
    freq_up: finite(C.frequency) && finite(B.frequency) && C.frequency > B.frequency,
    ctr_down: finite(C.ctr) && finite(B.ctr) && C.ctr <= B.ctr * FATIGUE.CTR_FACTOR,
    cpa_up: finite(C.cpa) && finite(B.cpa) && C.cpa >= B.cpa * FATIGUE.CPA_FACTOR,
  };
  const count = Object.values(signals).filter(Boolean).length;
  const state = count === 3 ? STATES.FATIGUED : count > 0 ? STATES.SIGNALS : STATES.OK;
  return { state, signals, gates };
}
