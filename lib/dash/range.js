import { shift, localDate, dayMs } from '../dates.js';

export const today = nowMs => localDate(new Date(Number(nowMs)));
export const provisionalFrom = D => shift(D, -2);
// Days that are closed but that Meta can still adjust a little: from D-7 up to the provisional days.
export const adjustableFrom = D => shift(D, -7);
export const isAdjustable = (date, D) => date >= adjustableFrom(D) && date < provisionalFrom(D);
export const closedThrough = D => shift(D, -3);
export const isProvisional = (date, D) => date >= provisionalFrom(D);
export const spanDays = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / dayMs) + 1;
