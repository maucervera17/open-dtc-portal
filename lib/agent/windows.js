// Date windows named by their real dates, never by "esta semana": the readers open the dashboard days later.
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const parts = date => { const m = ISO.exec(String(date)); return m ? { month: Number(m[2]), day: Number(m[3]) } : null; };

// "21 sep"
export function dayLabel(date) {
  const p = parts(date);
  return p ? `${p.day} ${MONTHS[p.month - 1]}` : '';
}

// "21 al 27 sep" in one month, "28 sep al 4 oct" across two. Empty when a date is not valid.
export function rangeLabel(from, to) {
  const a = parts(from), b = parts(to);
  if (!a || !b) return '';
  if (a.month === b.month) return a.day === b.day ? dayLabel(to) : `${a.day} al ${b.day} ${MONTHS[b.month - 1]}`;
  return `${dayLabel(from)} al ${dayLabel(to)}`;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const validRange = w => w && typeof w === 'object' && ISO_DAY.test(String(w.from)) && ISO_DAY.test(String(w.to)) && String(w.from) <= String(w.to);

// The two comparison windows as stored with a run; null for anything that is not a pair of valid ranges (old runs have none).
export function cleanWindows(windows) {
  return validRange(windows?.C) && validRange(windows?.B)
    ? { C: { from: windows.C.from, to: windows.C.to }, B: { from: windows.B.from, to: windows.B.to } }
    : null;
}
