import test from "node:test";
import assert from "node:assert/strict";
import { localNow, waterSlotDue, workoutDue } from "./schedule.mjs";

const water = { on: true, from: "09:00", to: "21:00", every: 2 };
const at = (h, m = 0, date = "2026-11-05") => ({ date, minutes: h * 60 + m });

test("local time follows the person's time zone", () => {
  const now = new Date("2026-11-05T12:30:00Z");
  assert.deepEqual(localNow(now, "Asia/Kolkata"), { date: "2026-11-05", minutes: 18 * 60 });
  assert.deepEqual(localNow(now, "America/New_York"), { date: "2026-11-05", minutes: 7 * 60 + 30 });
  assert.deepEqual(localNow(now, "Not/AZone"), { date: "2026-11-05", minutes: 12 * 60 + 30 });
});

test("water: due at each slot, once", () => {
  assert.equal(waterSlotDue(water, at(9, 5), null), "2026-11-05@540");
  assert.equal(waterSlotDue(water, at(9, 20), "2026-11-05@540"), null);   // already sent
  assert.equal(waterSlotDue(water, at(10, 0), "2026-11-05@540"), null);   // between slots
  assert.equal(waterSlotDue(water, at(11, 0), "2026-11-05@540"), "2026-11-05@660");
  assert.equal(waterSlotDue(water, at(21, 10), null), "2026-11-05@1260"); // last slot
});

test("water: nothing outside the window, when off, or when too late", () => {
  assert.equal(waterSlotDue(water, at(8, 50), null), null);
  assert.equal(waterSlotDue(water, at(22, 0), null), null);
  assert.equal(waterSlotDue({ ...water, on: false }, at(9, 0), null), null);
  assert.equal(waterSlotDue(water, at(9, 50), null), null); // 50 min late: skip, next slot will come
});

test("water: every 1.5 hours", () => {
  const w = { ...water, every: 1.5 };
  assert.equal(waterSlotDue(w, at(10, 30), "2026-11-05@540"), "2026-11-05@630");
});

test("workout: once a day after the chosen time", () => {
  const w = { on: true, time: "18:00" };
  assert.equal(workoutDue(w, at(17, 59), null), null);
  assert.equal(workoutDue(w, at(18, 10), null), "2026-11-05");
  assert.equal(workoutDue(w, at(18, 25), "2026-11-05"), null);
  assert.equal(workoutDue(w, at(18, 0, "2026-11-06"), "2026-11-05"), "2026-11-06");
  assert.equal(workoutDue(w, at(21, 0), null), null); // more than 2 hours late
});
