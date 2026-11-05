// Decides when a reminder is due. Pure functions, so they can be tested without Firebase.

const toMin = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

// The person's local date and minutes since midnight, in their own time zone
export function localNow(now, timeZone) {
  let tz = timeZone;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = "UTC"; }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

// Water: every N hours from "from" to "to". Returns a key for the slot that is due, or null.
// A slot stays due for 45 minutes, so a late-running job still sends it once.
export function waterSlotDue(cfg, local, lastSlot) {
  if (!cfg?.on) return null;
  const from = toMin(cfg.from), to = toMin(cfg.to), every = Math.round(Number(cfg.every) * 60);
  if (from == null || to == null || !(every >= 30) || to < from) return null;
  if (local.minutes < from || local.minutes > to + 45) return null;
  const slot = from + Math.floor((local.minutes - from) / every) * every;
  if (slot > to || local.minutes - slot > 45) return null;
  const key = `${local.date}@${slot}`;
  return key === lastSlot ? null : key;
}

// Workout: once a day at "time". Due for 2 hours after that time, once per day.
export function workoutDue(cfg, local, lastDate) {
  if (!cfg?.on) return null;
  const t = toMin(cfg.time);
  if (t == null || local.minutes < t || local.minutes - t > 120) return null;
  return lastDate === local.date ? null : local.date;
}

export function workoutMinutes(day) {
  return (Array.isArray(day?.workouts) ? day.workouts : []).reduce((s, w) => s + (Number(w.minutes) || 0), 0);
}

export const DEFAULT_GOALS = { steps: 10000, water: 8, sleep: 8, workout: 30 };

// ---------- Cycle phases (also used by the app itself) ----------
// Estimated from logged period start dates and cycle length:
// period ~5 days, ovulation ~14 days before the next period (±1 day), luteal until the next period.
const dayNum = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const isoOf = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

export function cycleLength(cycle) {
  const starts = [...new Set(Array.isArray(cycle?.starts) ? cycle.starts : [])].sort();
  const gaps = [];
  for (let i = 1; i < starts.length; i++) {
    const g = dayNum(starts[i]) - dayNum(starts[i - 1]);
    if (g >= 15 && g <= 60) gaps.push(g);
  }
  const avg = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
  return cycle?.length || avg || 28;
}

export function cyclePhase(cycle, dateISO) {
  const starts = [...new Set(Array.isArray(cycle?.starts) ? cycle.starts : [])].sort();
  const last = [...starts].reverse().find((d) => d <= dateISO);
  if (!last) return null;
  const len = cycleLength(cycle);
  const day = dayNum(dateISO) - dayNum(last) + 1;
  if (day > len + 10) return null; // no recent period logged; don't guess
  const ovu = Math.max(8, len - 14);
  const s = dayNum(last);
  let phase, from;
  if (day <= 5) { phase = "menstrual"; from = s; }
  else if (day < ovu - 1) { phase = "follicular"; from = s + 5; }
  else if (day <= ovu + 1) { phase = "ovulation"; from = s + ovu - 2; }
  else if (day <= len) { phase = "luteal"; from = s + ovu + 1; }
  else { phase = "late"; from = s + len; }
  return { phase, day, length: len, since: isoOf(from) };
}

export const PHASES = {
  menstrual: {
    name: "Period",
    note: "Energy may be lower and cramps are common. Rest, warmth and a little extra patience help.",
    title: (n) => `${n}'s period has started`,
  },
  follicular: {
    name: "Follicular phase",
    note: "Energy and mood often lift. A great week for plans and workouts together.",
    title: (n) => `${n} is in her follicular phase`,
  },
  ovulation: {
    name: "Ovulation",
    note: "Many feel confident, social and energetic around now.",
    title: (n) => `${n} is around ovulation`,
  },
  luteal: {
    name: "Luteal phase",
    note: "Energy may dip and mood can be more sensitive, especially in the last few days. Kindness goes a long way.",
    title: (n) => `${n} is in her luteal phase`,
  },
  late: {
    name: "Period expected",
    note: "Her next period is due around now. Comfort and patience help.",
    title: (n) => `${n}'s period is due around now`,
  },
};
