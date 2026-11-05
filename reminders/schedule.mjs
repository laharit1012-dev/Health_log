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
