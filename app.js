// =====================================================================
// Health Log: each person signs up with email and password and logs their
// own daily steps, water, sleep, workout and food. Logs are private;
// a share code lets someone else view (never change) your log.
// Login and storage: Firebase Authentication + Cloud Firestore.
// =====================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, sendEmailVerification, reload,
  EmailAuthProvider, reauthenticateWithCredential, deleteUser,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, collection, onSnapshot, setDoc, getDoc, getDocs, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=10";

// ---------- Theme (light / dark) ----------
const THEME_KEY = "theme";
const root = document.documentElement;
const themeToggle = document.getElementById("theme-toggle");
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function savedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}

function currentTheme() {
  return root.dataset.theme || (systemDark.matches ? "dark" : "light");
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  const isDark = theme === "dark";
  themeToggle.setAttribute("aria-checked", String(isDark));
  themeToggle.querySelector(".theme-toggle__label").textContent = isDark ? "Dark" : "Light";
}

themeToggle.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch {}
});

// Follow the device setting until the user picks a theme themselves
systemDark.addEventListener("change", (e) => {
  if (!savedTheme()) applyTheme(e.matches ? "dark" : "light");
});

applyTheme(savedTheme() || currentTheme());

// ---------- Goals ----------
const GOALS = { steps: 10000, water: 8, sleepMin: 7, sleepMax: 9 };
const GLASS_ML = 250;
const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack"];

// ---------- Date helpers ----------
function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function shiftDate(iso, days) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}
const todayISO = () => toISO(new Date());

function dayTitle(iso) {
  const today = todayISO();
  if (iso === today) return "Today";
  if (iso === shiftDate(today, -1)) return "Yesterday";
  return fromISO(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function sleepHours(bed, wake) {
  if (!bed || !wake) return null;
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  let mins = toMin(wake) - toMin(bed);
  if (mins <= 0) mins += 24 * 60; // slept past midnight
  return mins / 60;
}

function formatHours(h) {
  if (h == null) return "—";
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins ? `${whole}h ${mins}m` : `${whole}h`;
}

const fmt = (n) => Number(n).toLocaleString();

function emptyLog(date) {
  return {
    date,
    steps: null,
    water: 0,
    sleep: { bed: "", wake: "" },
    workouts: [],
    foods: [],
  };
}

// Fill in any missing fields so older or partial records still render
function normalize(log, date) {
  const base = emptyLog(date);
  if (!log) return base;
  const { workout, ...rest } = log;
  return {
    ...base, ...rest,
    sleep: { ...base.sleep, ...(log.sleep || {}) },
    foods: Array.isArray(log.foods) ? log.foods : [],
    workouts: Array.isArray(log.workouts) ? log.workouts : legacyWorkout(log.workout),
  };
}

// Older logs kept one workout as { type, minutes, notes }
function legacyWorkout(w) {
  if (!w || (!w.type && !w.minutes && !w.notes)) return [];
  return [{ id: "w-earlier", type: w.type || "Other", minutes: w.minutes ?? null, notes: w.notes || "" }];
}

const workoutMinutes = (log) => log.workouts.reduce((sum, w) => sum + (Number(w.minutes) || 0), 0);

// ---------- Storage (Cloud Firestore) ----------
// Private to each person (locked by the security rules in firestore.rules):
//   users/<uid>              { name, gender, cycle: { starts, length }, shareCode, links: [{ code, name }] }
//   users/<uid>/days/<date>  { steps, water, sleep, workouts, foods }
// Shared copy, only while sharing is on (readable by signed-in people who
// know the code; the code can't be listed or guessed in practice):
//   shares/<code>              { owner: <uid>, name, cycle (only if she chose to share it) }
//   shares/<code>/days/<date>  copy of each day
function firestoreStore(db, uid) {
  const userRef = doc(db, "users", uid);
  const dayRef = (date) => doc(db, "users", uid, "days", date);
  const shareRef = (code) => doc(db, "shares", code);
  const shareDayRef = (code, date) => doc(db, "shares", code, "days", date);
  const watch = (ref, cb, onError) =>
    onSnapshot(ref, { includeMetadataChanges: false },
      (snap) => cb(snap.exists() ? snap.data() : null, snap.metadata),
      (err) => onError?.(err));
  const mergeUser = (data) => setDoc(userRef, data, { merge: true });

  return {
    kind: "account",
    canLink: true,
    watchProfile: (cb, onError) => watch(userRef, (d, m) => cb(d
      ? { name: d.name || "", gender: d.gender || "", cycle: d.cycle || null }
      : null, m), onError),
    watchSharing: (cb, onError) => watch(userRef, (d, m) => cb(d?.shareCode ? { code: d.shareCode, cycle: !!d.shareCycle } : null, m), onError),
    watchLinks: (cb, onError) => watch(userRef, (d, m) => cb({ people: Array.isArray(d?.links) ? d.links : [] }, m), onError),
    watchDay: (date, cb, onError) => watch(dayRef(date), cb, onError),
    saveDay: (log) => setDoc(dayRef(log.date), log),
    saveName: (name) => mergeUser({ name }),
    saveProfile: (changes) => mergeUser(changes),       // { name?, gender? }
    saveCycle: (cycle) => mergeUser({ cycle }),         // private: never copied to shares
    saveSharing: (code, shareCycle = false) => mergeUser({ shareCode: code, shareCycle }),
    saveLinks: (people) => mergeUser({ links: people }),

    // Copies kept for people you share with
    mirrorDay: (code, log) => setDoc(shareDayRef(code, log.date), log),
    // The shared header: name, plus period data only if she chose to share it
    mirrorProfile: (code, name, cycle) => setDoc(shareRef(code), { owner: uid, name, cycle: cycle || null }),
    async copyAllDays(code) {
      const snap = await getDocs(collection(db, "users", uid, "days"));
      for (const d of snap.docs) await setDoc(shareDayRef(code, d.id), d.data());
    },
    // Delete every document this person owns (logs, profile)
    async deleteEverything() {
      const snap = await getDocs(collection(db, "users", uid, "days"));
      for (const d of snap.docs) await deleteDoc(d.ref);
      await deleteDoc(userRef);
    },
    async removeCopies(code) {
      const snap = await getDocs(collection(db, "shares", code, "days"));
      for (const d of snap.docs) await deleteDoc(d.ref);
      await deleteDoc(shareRef(code));
    },

    // Someone else's shared log
    async sharedName(code) {
      try {
        const snap = await getDoc(shareRef(code));
        return snap.exists() ? (snap.data().name || "") : null;
      } catch (err) {
        if (err?.code === "permission-denied") return null;
        throw err;
      }
    },
    watchSharedProfile: (code, cb, onError) => watch(shareRef(code), cb, onError),
    watchSharedDay: (code, date, cb, onError) => watch(shareDayRef(code, date), cb, onError),
  };
}

// Share codes: 12 characters without look-alikes (no 0/O, 1/I/L), e.g. K7QF-9XMA-2PDW
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newShareCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}
function normalizeCode(input) {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 12 || [...raw].some((c) => !CODE_CHARS.includes(c))) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

// ---------- App state ----------
let store = null;
let me = null;             // { email } of the signed-in person
let profile = null;        // { name, gender, cycle } chosen in the app
let dayLog = null;         // stored log for `date`
let loaded = false;
let date = todayISO();
const drafts = {};         // date -> log with unsaved edits
let unwatchDay = null;
let blocked = "";          // message when this person can't save

let sharing = null;        // { code, cycle } when sharing is on; cycle = period data is shared too
let links = [];            // [{ code, name }] people whose logs you can see
let viewing = null;        // null = your own log, otherwise a linked person's code
let viewName = "";         // name of the linked person being viewed
let viewCycle = null;      // their period data, only if they chose to share it
let viewGone = false;      // the linked person stopped sharing
let pendingShare = false;  // create a code as soon as a name is saved

const logNow = () => (viewing ? normalize(dayLog, date) : drafts[date] || normalize(dayLog, date));
const displayName = () => profile?.name || "";
const isFemale = () => profile?.gender === "female";
let dayReady = false;      // the log for `date` has arrived; editing before that could overwrite it
const readOnly = () => !!blocked || !!viewing || !store || !dayReady;

// ---------- Saving (debounced, one write at a time per day) ----------
const timers = {};
const chains = {};
let saving = 0;

function edit(mutate) {
  if (readOnly()) return;
  const log = structuredClone(logNow());
  mutate(log);
  const d = log.date;
  drafts[d] = log;
  clearTimeout(timers[d]);
  timers[d] = setTimeout(() => flush(d), 500);
  render();
}

function flush(d) {
  const log = drafts[d];
  if (!log) return;
  saving++;
  setStatus();
  chains[d] = (chains[d] || Promise.resolve())
    .then(() => store.saveDay(log))
    .then(() => (sharing?.code ? store.mirrorDay(sharing.code, log) : null))
    .then(() => { if (drafts[d] === log) delete drafts[d]; })
    .catch((err) => handleWriteError(err))
    .finally(() => { saving--; setStatus(); render(); });
}

function handleWriteError(err) {
  if (err?.code === "invalid_argument" || err?.code === "not_granted") {
    blocked = "You can view this page but can't save. Ask the owner to give you edit access from the Share menu.";
  } else if (err?.code === "quota_exceeded") {
    setStatus("Storage is full. Delete some old entries to keep logging.");
  } else {
    setStatus("Couldn't save. Check your connection and try again.");
  }
}

// ---------- Status line ----------
const statusEl = document.getElementById("sync-status");
let statusOverride = "";
let loadTimer = null;

function setStatus(message) {
  if (message !== undefined) statusOverride = message;
  if (blocked) statusEl.textContent = blocked;
  else if (viewing) statusEl.textContent = "View only";
  else if (statusOverride) statusEl.textContent = statusOverride;
  else if (saving > 0) statusEl.textContent = "Saving…";
  else if (!loaded) statusEl.textContent = "Loading…";
  else statusEl.textContent = store?.kind === "account" ? "Private to you · saved" : "Saved on this device";
}

// ---------- Elements ----------
const $ = (id) => document.getElementById(id);
const el = {
  who: $("who"), whoName: $("who-name"), signOutBtn: $("sign-out"),
  dayBar: $("day-bar"), dayTitle: $("day-title"), dayInput: $("day-input"), prev: $("prev-day"), next: $("next-day"),
  signin: $("signin-panel"), summaryPanel: $("summary-panel"), summary: $("summary"),
  panel: $("log-panel"), logTitle: $("log-title"),
  editName: $("edit-name"), renameForm: $("rename-form"), renameInput: $("rename-input"), cancelRename: $("cancel-rename"),
  renameGender: $("rename-gender"), genderPrompt: $("gender-prompt"), genderPromptBtn: $("gender-prompt-btn"),
  cycleSection: $("cycle-section"), cycleScope: $("cycle-scope"), cycleDay: $("cycle-day"), cycleHint: $("cycle-hint"),
  cycleForm: $("cycle-form"), cycleDate: $("cycle-date"), cycleMsg: $("cycle-msg"),
  cycleLength: $("cycle-length"), cycleAvg: $("cycle-avg"), cycleHistory: $("cycle-history"),
  steps: $("steps"), stepsBar: $("steps-bar"), stepsHint: $("steps-hint"),
  waterMinus: $("water-minus"), waterPlus: $("water-plus"), waterCount: $("water-count"), waterBar: $("water-bar"), waterHint: $("water-hint"),
  bed: $("sleep-bed"), wake: $("sleep-wake"), sleepHint: $("sleep-hint"),
  wForm: $("workout-form"), wType: $("workout-type"), wMin: $("workout-min"), wNotes: $("workout-notes"),
  wList: $("workout-list"), wTotal: $("workout-total"), wMsg: $("workout-msg"),
  foodForm: $("food-form"), foodMeal: $("food-meal"), foodItem: $("food-item"), foodCal: $("food-cal"),
  foodList: $("food-list"), foodTotal: $("food-total"),
  people: $("people"), viewNote: $("view-note"), summaryTitle: $("summary-title"),
  linkPanel: $("link-panel"), shareOff: $("share-off"), shareOn: $("share-on"), shareCode: $("share-code"),
  shareCreate: $("share-create"),
  shareCycleAsk: $("share-cycle-ask"), shareCycleYes: $("share-cycle-yes"), shareCycleNo: $("share-cycle-no"),
  shareCycleSetting: $("share-cycle-setting"), shareCycleState: $("share-cycle-state"), shareCycleToggle: $("share-cycle-toggle"), shareCopy: $("share-copy"), shareStop: $("share-stop"),
  shareConfirm: $("share-confirm"), shareStopYes: $("share-stop-yes"), shareStopNo: $("share-stop-no"), shareMsg: $("share-msg"),
  accountPanel: $("account-panel"), accountEmail: $("account-email"),
  deleteStart: $("delete-start"), deleteForm: $("delete-form"), deletePassword: $("delete-password"),
  deleteMsg: $("delete-msg"), deleteConfirm: $("delete-confirm"), deleteCancel: $("delete-cancel"),
  verifyPanel: $("verify-panel"), verifyEmail: $("verify-email"), verifyMsg: $("verify-msg"),
  verifyDone: $("verify-done"), verifyResend: $("verify-resend"), verifySignout: $("verify-signout"),
  installTip: $("install-tip"), installText: $("install-text"), installBtn: $("install-btn"), installClose: $("install-close"),
  linkForm: $("link-form"), linkCode: $("link-code"), linkMsg: $("link-msg"), linkList: $("link-list"),
};

const editableControls = () => [
  el.steps, el.waterMinus, el.waterPlus, el.bed, el.wake, el.wType, el.wMin, el.wNotes,
  ...el.wForm.querySelectorAll("button"),
  el.foodMeal, el.foodItem, el.foodCal, ...el.foodForm.querySelectorAll("button"),
];

// Only touch an input's value when the person isn't typing in it
function setValue(input, value) {
  if (document.activeElement === input) return;
  const v = value ?? "";
  if (input.value !== String(v)) input.value = v;
}

const caloriesOf = (log) => log.foods.reduce((sum, f) => sum + (Number(f.calories) || 0), 0);

// ---------- Rendering ----------
let signedOut = false;

function render() {
  el.dayTitle.textContent = dayTitle(date);
  setValue(el.dayInput, date);
  el.next.disabled = date >= todayISO();

  // Who is signed in
  const name = displayName();
  el.who.hidden = !me;
  if (me) el.whoName.textContent = name || me.email;

  el.signin.hidden = !signedOut || !el.verifyPanel.hidden;
  el.dayBar.hidden = signedOut || !store;
  el.summaryPanel.hidden = signedOut || !store;
  el.panel.hidden = signedOut || !store;
  el.linkPanel.hidden = signedOut || !store?.canLink || !!blocked;
  el.accountPanel.hidden = signedOut || !store;
  if (me) el.accountEmail.textContent = me.email;
  el.people.hidden = signedOut || links.length === 0;
  if (signedOut || !store) return;

  renderPeople();
  renderSummary();
  renderPanel();
  renderLinkPanel();
  setStatus();
}

function renderPeople() {
  el.people.replaceChildren();
  if (!links.length) return;
  const chip = (label, code) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "person-chip";
    b.textContent = label;
    b.setAttribute("aria-pressed", String(viewing === code));
    b.addEventListener("click", () => viewPerson(code));
    el.people.append(b);
  };
  chip(displayName() ? `${displayName()} (you)` : "You", null);
  for (const p of links) chip(p.name || "Linked person", p.code);
}

function renderLinkPanel() {
  if (el.linkPanel.hidden) return;
  const on = !!sharing?.code;
  el.shareOff.hidden = on;
  el.shareOn.hidden = !on;
  if (on) el.shareCode.textContent = sharing.code;
  el.shareCycleSetting.hidden = !(on && isFemale());
  if (on && isFemale()) {
    el.shareCycleState.textContent = sharing.cycle
      ? "Period tracker: shared with people who have your code."
      : "Period tracker: private. People with your code don't see it.";
    el.shareCycleToggle.textContent = sharing.cycle ? "Stop sharing period tracker" : "Share period tracker too";
  }
  el.shareStop.hidden = !el.shareConfirm.hidden;

  el.linkList.replaceChildren();
  for (const p of links) {
    const li = document.createElement("li");
    li.className = "link-row";
    const name = document.createElement("span");
    name.className = "link-row__name";
    name.textContent = p.name || "Linked person";
    const view = document.createElement("button");
    view.type = "button";
    view.className = "btn btn--ghost btn--small";
    view.textContent = viewing === p.code ? "Viewing" : "View";
    view.disabled = viewing === p.code;
    view.addEventListener("click", () => { viewPerson(p.code); window.scrollTo({ top: 0, behavior: "smooth" }); });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "food-row__delete";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Stop viewing ${p.name || "this person"}'s log`);
    remove.addEventListener("click", () => unlink(p.code));
    li.append(name, view, remove);
    el.linkList.append(li);
  }
}

function renderSummary() {
  const log = logNow();
  const hours = sleepHours(log.sleep.bed, log.sleep.wake);
  const kcal = caloriesOf(log);
  el.summary.replaceChildren();

  const addStat = (label, value, unit) => {
    const wrap = document.createElement("div");
    wrap.className = "stat";
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (unit) {
      const small = document.createElement("small");
      small.textContent = " " + unit;
      dd.append(small);
    }
    wrap.append(dt, dd);
    el.summary.append(wrap);
  };

  addStat("Steps", log.steps != null ? fmt(log.steps) : "—", log.steps != null ? `/ ${fmt(GOALS.steps)}` : "");
  addStat("Water", String(log.water), `/ ${GOALS.water} glasses`);
  addStat("Sleep", formatHours(hours));
  const wMins = workoutMinutes(log);
  const wCount = log.workouts.length;
  addStat("Workouts", wCount ? (wMins ? `${fmt(wMins)} min` : String(wCount)) : "—",
    wCount ? (wMins ? `${wCount} workout${wCount === 1 ? "" : "s"}` : (wCount === 1 ? "workout" : "workouts")) : "");
  if (viewing ? !!viewCycle : isFemale()) {
    const c = cycleInfo(viewing ? viewCycle : profile.cycle, date);
    if (c.last) addStat("Cycle", `Day ${diffDays(c.last, date) + 1}`, `next ~${shortDate(shiftDate(c.last, c.len))}`);
    else addStat("Cycle", "—");
  }
  addStat("Food", log.foods.length ? String(log.foods.length) : "—",
    log.foods.length
      ? (log.foods.length === 1 ? "item" : "items") + (kcal ? ` · ${fmt(kcal)} kcal` : "")
      : "");
}

function renderWorkouts(log) {
  const mins = workoutMinutes(log);
  const n = log.workouts.length;
  el.wTotal.textContent = n ? `${n} workout${n === 1 ? "" : "s"}${mins ? ` · ${fmt(mins)} min` : ""}` : "";
  el.wForm.hidden = !!viewing;
  el.wList.replaceChildren();

  if (!n) {
    const p = document.createElement("p");
    p.className = "food-empty";
    p.textContent = viewing ? "No workouts logged for this day." : "No workouts yet. Pick a type above and tap Add. Add as many as you did.";
    el.wList.append(p);
    return;
  }

  const ul = document.createElement("ul");
  const wrap = document.createElement("div");
  wrap.className = "meal-group";
  for (const w of log.workouts) {
    const li = document.createElement("li");
    li.className = "food-row";
    const item = document.createElement("span");
    item.className = "food-row__item";
    item.textContent = w.type;
    if (w.notes) {
      const small = document.createElement("small");
      small.textContent = w.notes;
      item.append(small);
    }
    const meta = document.createElement("span");
    meta.className = "food-row__meta";
    meta.textContent = w.minutes ? `${fmt(w.minutes)} min` : "";
    li.append(item, meta);
    if (!readOnly()) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "food-row__delete";
      del.textContent = "✕";
      del.setAttribute("aria-label", `Remove ${w.type}`);
      del.addEventListener("click", () => {
        edit((l) => { l.workouts = l.workouts.filter((x) => x.id !== w.id); });
      });
      li.append(del);
    }
    ul.append(li);
  }
  wrap.append(ul);
  el.wList.append(wrap);
}

// ---------- Period (cycle) ----------
const diffDays = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 86400000);
const shortDate = (iso) => fromISO(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const longDate = (iso) => fromISO(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

// starts: period start dates; length: the usual cycle length she set (optional)
function cycleInfo(cycle, refISO) {
  const starts = [...new Set(Array.isArray(cycle?.starts) ? cycle.starts : [])].sort();
  const gaps = [];
  for (let i = 1; i < starts.length; i++) {
    const g = diffDays(starts[i - 1], starts[i]);
    if (g >= 15 && g <= 60) gaps.push(g);
  }
  const avg = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
  const len = cycle?.length || avg || 28;
  const last = [...starts].reverse().find((d) => d <= refISO) || null;
  return { starts, avg, len, last };
}

function renderCycle() {
  const show = viewing ? !!viewCycle : isFemale() && !!store;
  el.cycleSection.hidden = !show;
  if (!show) return;

  const ro = readOnly();
  const cycle = (viewing ? viewCycle : profile.cycle) || {};
  el.cycleForm.hidden = ro;
  el.cycleLength.closest(".field").hidden = ro;
  el.cycleScope.textContent = viewing ? `Shared by ${viewName || "them"}` : "Private to you";
  const { starts, avg, len, last } = cycleInfo(cycle, date);

  if (!last) {
    el.cycleDay.textContent = "—";
    el.cycleHint.textContent = starts.length
      ? "No period logged on or before this day."
      : "Log the day your last period started to see your cycle day and when the next one is expected.";
  } else {
    const day = diffDays(last, date) + 1;
    const next = shiftDate(last, len);
    const until = diffDays(date, next);
    el.cycleDay.textContent = `Day ${day}`;
    el.cycleHint.textContent = until > 0
      ? `of your cycle · next period expected around ${shortDate(next)} (in ${until} day${until === 1 ? "" : "s"})`
      : until === 0
        ? "of your cycle · next period expected today"
        : `of your cycle · next period was expected around ${shortDate(next)} (${-until} day${until === -1 ? "" : "s"} ago)`;
  }
  if (viewing && !last && !starts.length) el.cycleHint.textContent = "No periods logged yet.";

  el.cycleDate.max = todayISO();
  if (!el.cycleDate.value) el.cycleDate.value = date;
  setValue(el.cycleLength, cycle.length ?? "");
  el.cycleLength.placeholder = String(avg || 28);
  el.cycleAvg.textContent = avg
    ? `Average cycle length: ${avg} days.${cycle.length ? ` Usual length set to ${cycle.length} days.` : ""}`
    : ro ? (cycle.length ? `Usual cycle length: ${cycle.length} days.` : "")
    : starts.length < 2 ? "Log two or more periods to see your average cycle length." : "";

  el.cycleHistory.replaceChildren();
  for (const d of [...starts].reverse().slice(0, 6)) {
    const li = document.createElement("li");
    li.className = "link-row";
    const name = document.createElement("span");
    name.className = "link-row__name";
    name.textContent = longDate(d);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "food-row__delete";
    del.textContent = "Remove";
    del.setAttribute("aria-label", `Remove period starting ${longDate(d)}`);
    del.addEventListener("click", () => saveCycle({ starts: starts.filter((x) => x !== d), length: cycle.length ?? null }));
    li.append(name);
    if (!ro) li.append(del);
    el.cycleHistory.append(li);
  }
}

async function saveCycle(cycle) {
  if (readOnly()) return;
  profile = { ...(profile || {}), cycle };
  render();
  try { await store.saveCycle(cycle); await syncShareProfile(); } catch (err) { handleWriteError(err); render(); }
}

el.cycleForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const d = el.cycleDate.value;
  const cycle = profile?.cycle || {};
  const starts = Array.isArray(cycle.starts) ? cycle.starts : [];
  if (!d) { el.cycleMsg.textContent = "Pick the date your period started."; return; }
  if (d > todayISO()) { el.cycleMsg.textContent = "That date is in the future. Pick today or an earlier day."; return; }
  if (starts.includes(d)) { el.cycleMsg.textContent = "That date is already logged."; return; }
  el.cycleMsg.textContent = `Logged: period started ${longDate(d)}.`;
  saveCycle({ starts: [...starts, d].sort().slice(-24), length: cycle.length ?? null });
});

let cycleLenTimer = null;
el.cycleLength.addEventListener("input", () => {
  clearTimeout(cycleLenTimer);
  cycleLenTimer = setTimeout(() => {
    const v = el.cycleLength.value;
    const n = v === "" ? null : Math.round(Number(v));
    if (n !== null && (n < 15 || n > 60)) {
      el.cycleMsg.textContent = "Cycle length should be between 15 and 60 days.";
      return;
    }
    el.cycleMsg.textContent = "";
    const cycle = profile?.cycle || {};
    saveCycle({ starts: Array.isArray(cycle.starts) ? cycle.starts : [], length: n });
  }, 600);
});

function renderPanel() {
  const log = logNow();
  if (viewing) {
    const name = viewName || "Linked person";
    el.logTitle.textContent = `${name}'s log`;
    el.summaryTitle.textContent = `${name}'s day`;
    el.editName.hidden = true;
    el.renameForm.hidden = true;
    el.genderPrompt.hidden = true;
    el.viewNote.hidden = false;
    el.viewNote.textContent = viewGone
      ? "This person has turned off sharing or changed their code. Ask them for their new code."
      : `You're viewing ${name}'s log. Only they can change it.`;
  } else {
    const name = displayName();
    el.logTitle.textContent = name ? `${name}'s log` : "Your log";
    el.summaryTitle.textContent = "Your day";
    el.editName.hidden = !!blocked || !el.renameForm.hidden;
    el.editName.textContent = name ? "Edit profile" : "Add your name";
    el.viewNote.hidden = true;
    el.genderPrompt.hidden = !(profile && !profile.gender && el.renameForm.hidden && !blocked);
  }

  // Steps
  setValue(el.steps, log.steps);
  el.stepsBar.style.width = Math.min(100, ((log.steps || 0) / GOALS.steps) * 100) + "%";
  el.stepsHint.textContent = (log.steps || 0) >= GOALS.steps
    ? `Goal of ${fmt(GOALS.steps)} reached`
    : `${fmt(Math.max(0, GOALS.steps - (log.steps || 0)))} to go · goal ${fmt(GOALS.steps)}`;

  // Water
  el.waterCount.textContent = log.water;
  el.waterMinus.disabled = log.water <= 0;
  el.waterBar.style.width = Math.min(100, (log.water / GOALS.water) * 100) + "%";
  el.waterHint.textContent = `${fmt(log.water * GLASS_ML)} ml · glasses of ${GLASS_ML} ml · goal ${GOALS.water}`;

  // Sleep
  setValue(el.bed, log.sleep.bed);
  setValue(el.wake, log.sleep.wake);
  const hours = sleepHours(log.sleep.bed, log.sleep.wake);
  if (hours == null) el.sleepHint.textContent = `Goal ${GOALS.sleepMin}–${GOALS.sleepMax} hours`;
  else {
    const note = hours < GOALS.sleepMin ? "below goal" : hours > GOALS.sleepMax ? "above goal" : "in goal range";
    el.sleepHint.textContent = `${formatHours(hours)} of sleep · ${note}`;
  }

  // Period (women only, private)
  renderCycle();

  // Workouts
  renderWorkouts(log);

  // Food
  const kcal = caloriesOf(log);
  el.foodTotal.textContent = log.foods.length
    ? `${log.foods.length} item${log.foods.length === 1 ? "" : "s"}${kcal ? ` · ${fmt(kcal)} kcal` : ""}`
    : "";
  el.foodList.replaceChildren();

  if (log.foods.length === 0) {
    const p = document.createElement("p");
    p.className = "food-empty";
    p.textContent = viewing ? "No food logged for this day." : "Nothing logged yet. Add a meal or snack above.";
    el.foodList.append(p);
  }

  for (const meal of MEALS) {
    const items = log.foods.filter((f) => f.meal === meal);
    if (!items.length) continue;
    const group = document.createElement("div");
    group.className = "meal-group";
    const h = document.createElement("h4");
    h.textContent = meal;
    const ul = document.createElement("ul");
    for (const f of items) {
      const li = document.createElement("li");
      li.className = "food-row";
      const item = document.createElement("span");
      item.className = "food-row__item";
      item.textContent = f.item;
      const meta = document.createElement("span");
      meta.className = "food-row__meta";
      meta.textContent = [f.calories ? `${fmt(f.calories)} kcal` : "", f.time || ""].filter(Boolean).join(" · ");
      li.append(item, meta);
      if (!readOnly()) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "food-row__delete";
        del.textContent = "✕";
        del.setAttribute("aria-label", `Remove ${f.item}`);
        del.addEventListener("click", () => {
          edit((l) => { l.foods = l.foods.filter((x) => x.id !== f.id); });
        });
        li.append(del);
      }
      ul.append(li);
    }
    group.append(h, ul);
    el.foodList.append(group);
  }

  const disable = readOnly();
  el.foodForm.hidden = !!viewing;
  for (const c of editableControls()) {
    if (c === el.waterMinus) c.disabled = disable || log.water <= 0;
    else c.disabled = disable;
  }
}

// ---------- Inputs ----------
const numOrNull = (v) => (v === "" ? null : Math.max(0, Math.round(Number(v))));

el.steps.addEventListener("input", () => edit((l) => { l.steps = numOrNull(el.steps.value); }));
el.waterPlus.addEventListener("click", () => edit((l) => { l.water += 1; }));
el.waterMinus.addEventListener("click", () => edit((l) => { l.water = Math.max(0, l.water - 1); }));
el.bed.addEventListener("change", () => edit((l) => { l.sleep.bed = el.bed.value; }));
el.wake.addEventListener("change", () => edit((l) => { l.sleep.wake = el.wake.value; }));
el.wForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const type = el.wType.value;
  if (!type) {
    el.wMsg.textContent = "Choose a workout type, then tap Add.";
    el.wType.focus();
    return;
  }
  const entry = {
    id: "w" + Date.now() + Math.random().toString(36).slice(2, 6),
    type,
    minutes: numOrNull(el.wMin.value),
    notes: el.wNotes.value.trim(),
  };
  edit((l) => { l.workouts.push(entry); });
  el.wMsg.textContent = "";
  el.wType.value = "";
  el.wMin.value = "";
  el.wNotes.value = "";
});

// Pick a sensible default meal for the time of day
function defaultMeal() {
  const h = new Date().getHours();
  if (h < 11) return "Breakfast";
  if (h < 16) return "Lunch";
  if (h < 21) return "Dinner";
  return "Snack";
}
el.foodMeal.value = defaultMeal();

el.foodForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const item = el.foodItem.value.trim();
  if (!item) return;
  const now = new Date();
  const entry = {
    id: "f" + now.getTime() + Math.random().toString(36).slice(2, 6),
    meal: el.foodMeal.value,
    item,
    calories: numOrNull(el.foodCal.value),
    time: now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  };
  edit((l) => { l.foods.push(entry); });
  el.foodItem.value = "";
  el.foodCal.value = "";
  el.foodItem.focus();
});

// Edit your name
function closeRename() {
  el.renameForm.hidden = true;
  render();
}

el.genderPromptBtn.addEventListener("click", () => {
  el.editName.click();
  el.renameGender.focus();
});

el.editName.addEventListener("click", () => {
  el.renameInput.value = displayName();
  el.renameGender.value = profile?.gender || "";
  el.renameForm.hidden = false;
  render();
  el.renameInput.focus();
  el.renameInput.select();
});

el.renameForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = el.renameInput.value.trim();
  const gender = el.renameGender.value;
  if (!name || !store) return;
  closeRename();
  const changes = {};
  if (name !== profile?.name) changes.name = name;
  if (gender && gender !== profile?.gender) changes.gender = gender;
  if (Object.keys(changes).length) {
    profile = { ...(profile || {}), ...changes };
    render();
    try {
      await store.saveProfile(changes);
      if (sharing?.code) await syncShareProfile();
    } catch (err) {
      handleWriteError(err);
      render();
      return;
    }
  }
  if (pendingShare) {
    pendingShare = false;
    createShareCode();
  }
});

el.cancelRename.addEventListener("click", () => { pendingShare = false; closeRename(); });

// ---------- Share codes and linked people ----------
let shareBusy = false;

// Rewrite the shared header (name + period data if she shares it)
function syncShareProfile() {
  if (!sharing?.code || !store) return Promise.resolve();
  const cycle = sharing.cycle && isFemale() ? (profile?.cycle || { starts: [], length: null }) : null;
  return store.mirrorProfile(sharing.code, displayName(), cycle).catch(() => {});
}

let shareCycleChoice = null; // her answer to "Share your period tracker too?"

async function createShareCode() {
  if (shareBusy || !store?.canLink) return;
  const name = profile?.name;
  if (!name) {
    // Linked people need to know whose log they're looking at
    pendingShare = true;
    el.renameInput.value = displayName();
    el.renameGender.value = profile?.gender || "";
    el.renameForm.hidden = false;
    render();
    el.panel.scrollIntoView({ behavior: "smooth", block: "start" });
    el.renameInput.focus();
    el.shareMsg.textContent = "First, save the name linked people will see. Your code is created right after.";
    return;
  }
  if (isFemale() && shareCycleChoice === null) {
    // Ask before anything is shared
    el.shareCycleAsk.hidden = false;
    el.shareCreate.hidden = true;
    el.shareMsg.textContent = "";
    el.shareCycleYes.focus();
    return;
  }
  const withCycle = isFemale() && shareCycleChoice === true;
  shareCycleChoice = null;
  el.shareCycleAsk.hidden = true;
  el.shareCreate.hidden = false;
  shareBusy = true;
  el.shareCreate.disabled = true;
  el.shareMsg.textContent = "Creating your code…";
  const code = newShareCode();
  try {
    await store.mirrorProfile(code, name, withCycle ? (profile?.cycle || { starts: [], length: null }) : null);
    await store.copyAllDays(code);
    await store.saveSharing(code, withCycle);
    sharing = { code, cycle: withCycle };
    el.shareMsg.textContent = "Give this code to the person you want to share with.";
  } catch (err) {
    el.shareMsg.textContent = "Couldn't create a code. Check your connection and try again.";
  } finally {
    shareBusy = false;
    el.shareCreate.disabled = false;
    render();
  }
}

el.shareCreate.addEventListener("click", createShareCode);
el.shareCycleYes.addEventListener("click", () => { shareCycleChoice = true; createShareCode(); });
el.shareCycleNo.addEventListener("click", () => { shareCycleChoice = false; createShareCode(); });

// Change her mind later
el.shareCycleToggle.addEventListener("click", async () => {
  if (!sharing?.code || shareBusy) return;
  const next = !sharing.cycle;
  shareBusy = true;
  el.shareCycleToggle.disabled = true;
  try {
    sharing = { ...sharing, cycle: next };
    await store.saveSharing(sharing.code, next);
    await syncShareProfile();
    el.shareMsg.textContent = next
      ? "Your period tracker is now shared with people who have your code."
      : "Your period tracker is private again. People with your code no longer see it.";
  } catch {
    el.shareMsg.textContent = "Couldn't change that. Check your connection and try again.";
  } finally {
    shareBusy = false;
    el.shareCycleToggle.disabled = false;
    render();
  }
});

el.shareCopy.addEventListener("click", async () => {
  if (!sharing?.code) return;
  try {
    await navigator.clipboard.writeText(sharing.code);
    el.shareMsg.textContent = "Code copied.";
  } catch {
    const range = document.createRange();
    range.selectNodeContents(el.shareCode);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    el.shareMsg.textContent = "Code selected. Use Copy from your device's menu.";
  }
});

el.shareStop.addEventListener("click", () => { el.shareConfirm.hidden = false; render(); });
el.shareStopNo.addEventListener("click", () => { el.shareConfirm.hidden = true; render(); });

el.shareStopYes.addEventListener("click", async () => {
  if (!sharing?.code || shareBusy) return;
  shareBusy = true;
  el.shareStopYes.disabled = true;
  const code = sharing.code;
  try {
    await store.saveSharing(null);
    sharing = null;
    await store.removeCopies(code);
    el.shareMsg.textContent = "Sharing is off. Your old code no longer works.";
  } catch {
    el.shareMsg.textContent = "Couldn't turn off sharing. Check your connection and try again.";
  } finally {
    shareBusy = false;
    el.shareStopYes.disabled = false;
    el.shareConfirm.hidden = true;
    render();
  }
});

el.linkForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = normalizeCode(el.linkCode.value);
  if (!code) {
    el.linkMsg.textContent = "Codes have 12 letters and numbers, like K7QF-9XMA-2PDW. Check it and try again.";
    return;
  }
  if (code === sharing?.code) {
    el.linkMsg.textContent = "That's your own code. Enter the code someone else gave you.";
    return;
  }
  if (links.some((p) => p.code === code)) {
    el.linkMsg.textContent = "You're already linked with that person.";
    return;
  }
  el.linkMsg.textContent = "Looking up that code…";
  try {
    const name = await store.sharedName(code);
    if (name === null) {
      el.linkMsg.textContent = "No log found for that code. Check it with the person who gave it to you.";
      return;
    }
    links = [...links, { code, name }];
    await store.saveLinks(links);
    el.linkCode.value = "";
    el.linkMsg.textContent = `Linked. You can now see ${name ? name + "'s" : "their"} log.`;
    viewPerson(code);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch {
    el.linkMsg.textContent = "Couldn't link right now. Check your connection and try again.";
  }
});

async function unlink(code) {
  links = links.filter((p) => p.code !== code);
  if (viewing === code) viewPerson(null);
  render();
  try { await store.saveLinks(links); } catch { el.linkMsg.textContent = "Couldn't save that change. Try again."; }
}

let unwatchViewProfile = null;
function viewPerson(code) {
  if (viewing === code) return;
  viewing = code;
  viewGone = false;
  if (unwatchViewProfile) { unwatchViewProfile(); unwatchViewProfile = null; }
  if (code) {
    viewName = links.find((p) => p.code === code)?.name || "";
    viewCycle = null;
    unwatchViewProfile = store.watchSharedProfile(code, (p, meta) => {
      if (p) { viewName = p.name || viewName; viewCycle = p.cycle || null; viewGone = false; }
      else if (!meta?.fromCache) viewGone = true;
      render();
    }, () => {});
  }
  watchDay();
  render();
}
el.renameInput.addEventListener("keydown", (e) => { if (e.key === "Escape") closeRename(); });

// Day navigation
function setDate(iso) {
  if (!iso || iso === date) return;
  date = iso > todayISO() ? todayISO() : iso;
  if (store) watchDay();
  render();
}
el.prev.addEventListener("click", () => setDate(shiftDate(date, -1)));
el.next.addEventListener("click", () => setDate(shiftDate(date, 1)));
el.dayInput.addEventListener("change", () => setDate(el.dayInput.value));

// ---------- Subscriptions ----------
function onStoreError(err) {
  clearTimeout(loadTimer);
  loaded = true;
  setStatus(err?.code === "revoked"
    ? "This log is no longer available to you."
    : "Couldn't load your log. Reload the page to try again.");
  render();
}

function watchDay() {
  if (unwatchDay) unwatchDay();
  dayLog = null;
  loaded = false;
  dayReady = false;
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => {
    if (!loaded) setStatus("Can't reach your saved log yet. Still trying…");
  }, 10000);
  const onDay = (log, meta) => {
    dayLog = log;
    dayReady = true;
    if (!meta?.fromCache) {
      loaded = true;
      clearTimeout(loadTimer);
      if (statusOverride.startsWith("Can't reach")) statusOverride = "";
    }
    render();
  };
  unwatchDay = viewing
    ? store.watchSharedDay(viewing, date, onDay, onStoreError)
    : store.watchDay(date, onDay, onStoreError);
}

function start(s) {
  store = s;
  store.watchProfile((p) => { profile = p; render(); }, () => {});
  if (store.canLink) {
    store.watchSharing((d) => { sharing = d?.code ? d : null; render(); }, () => {});
    store.watchLinks((d) => {
      links = Array.isArray(d?.people) ? d.people : [];
      if (viewing && !links.some((p) => p.code === viewing)) viewPerson(null);
      render();
    }, () => {});
  }
  watchDay();
}

// Save edits before the page closes
window.addEventListener("pagehide", () => {
  for (const d of Object.keys(timers)) { clearTimeout(timers[d]); flush(d); }
});

// Keep "Today" correct if the app stays open past midnight
let lastToday = todayISO();
setInterval(() => {
  const t = todayISO();
  if (t !== lastToday) {
    if (date === lastToday) setDate(t);
    lastToday = t;
  }
}, 60000);

// ---------- Sign in / create account ----------
const auth_ = {
  title: $("auth-title"), intro: $("auth-intro"), tabIn: $("tab-signin"), tabUp: $("tab-signup"),
  form: $("auth-form"), nameField: $("auth-name-field"), name: $("auth-name"),
  genderField: $("auth-gender-field"), gender: $("auth-gender"),
  email: $("auth-email"), password: $("auth-password"), msg: $("auth-msg"),
  submit: $("auth-submit"), forgot: $("auth-forgot"), terms: $("auth-terms"),
};
let authMode = "signin";
let pendingProfile = null; // { name, gender } typed when creating an account

function setAuthMode(mode) {
  authMode = mode;
  const up = mode === "signup";
  auth_.tabIn.setAttribute("aria-selected", String(!up));
  auth_.tabUp.setAttribute("aria-selected", String(up));
  auth_.nameField.hidden = !up;
  auth_.genderField.hidden = !up;
  auth_.title.textContent = up ? "Create your account" : "Sign in";
  auth_.intro.textContent = up
    ? "Make an account to keep your own private log. Use a password with at least 6 characters."
    : "Your steps, water, sleep, workouts and food are private to you. Sign in to see your log.";
  auth_.submit.textContent = up ? "Create account" : "Sign in";
  auth_.password.autocomplete = up ? "new-password" : "current-password";
  auth_.forgot.hidden = up;
  auth_.terms.hidden = !up;
  auth_.msg.textContent = "";
}
auth_.tabIn.addEventListener("click", () => setAuthMode("signin"));
auth_.tabUp.addEventListener("click", () => setAuthMode("signup"));

function authMessage(err) {
  switch (err?.code) {
    case "auth/invalid-email": return "That email address doesn't look right. Check it and try again.";
    case "auth/missing-password": return "Enter your password.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found": return "Email or password is incorrect. Try again, or use Forgot password.";
    case "auth/email-already-in-use": return "There's already an account with this email. Sign in instead.";
    case "auth/weak-password": return "Use a password with at least 6 characters.";
    case "auth/too-many-requests": return "Too many attempts. Wait a few minutes, then try again.";
    case "auth/network-request-failed": return "Can't connect. Check your internet connection and try again.";
    default: return "Something went wrong. Try again.";
  }
}

let auth = null;

auth_.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!auth) return;
  const email = auth_.email.value.trim();
  const password = auth_.password.value;
  if (authMode === "signup" && !auth_.name.value.trim()) {
    auth_.msg.textContent = "Enter your name. It's shown on your log.";
    auth_.name.focus();
    return;
  }
  if (authMode === "signup" && !auth_.gender.value) {
    auth_.msg.textContent = "Choose your gender.";
    auth_.gender.focus();
    return;
  }
  auth_.submit.disabled = true;
  auth_.msg.textContent = authMode === "signup" ? "Creating your account…" : "Signing in…";
  try {
    if (authMode === "signup") {
      pendingProfile = { name: auth_.name.value.trim(), gender: auth_.gender.value };
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    auth_.password.value = "";
    auth_.msg.textContent = "";
  } catch (err) {
    pendingProfile = null;
    auth_.msg.textContent = authMessage(err);
  } finally {
    auth_.submit.disabled = false;
  }
});

auth_.forgot.addEventListener("click", async () => {
  if (!auth) return;
  const email = auth_.email.value.trim();
  if (!email) {
    auth_.msg.textContent = "Type your email above, then tap Forgot password again.";
    auth_.email.focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    auth_.msg.textContent = `If there's an account for ${email}, a reset link is on its way. Check your inbox and spam folder.`;
  } catch (err) {
    auth_.msg.textContent = authMessage(err);
  }
});

el.signOutBtn.addEventListener("click", async () => {
  for (const d of Object.keys(timers)) { clearTimeout(timers[d]); flush(d); }
  await Promise.allSettled(Object.values(chains));
  await signOut(auth);
  location.reload(); // start clean so nothing from this account stays on screen
});

// ---------- Email verification ----------
const appUrl = () => location.origin + location.pathname;
let currentUser = null;
let startApp = null;       // set once Firebase is ready

function showVerify(user) {
  signedOut = true;
  render();
  el.signin.hidden = true;
  el.verifyPanel.hidden = false;
  el.verifyEmail.textContent = user.email || "your email";
}

el.verifyDone.addEventListener("click", async () => {
  if (!currentUser) return;
  el.verifyDone.disabled = true;
  el.verifyMsg.textContent = "Checking…";
  try {
    await reload(currentUser);
    if (currentUser.emailVerified) {
      el.verifyMsg.textContent = "";
      el.verifyPanel.hidden = true;
      startApp(currentUser);
    } else {
      el.verifyMsg.textContent = "Not verified yet. Open the link in the email first, then tap this button again.";
    }
  } catch (err) {
    el.verifyMsg.textContent = authMessage(err);
  } finally {
    el.verifyDone.disabled = false;
  }
});

el.verifyResend.addEventListener("click", async () => {
  if (!currentUser) return;
  try {
    await sendEmailVerification(currentUser, { url: appUrl() });
    el.verifyMsg.textContent = "Sent. Check your inbox and spam folder.";
  } catch (err) {
    el.verifyMsg.textContent = err?.code === "auth/too-many-requests"
      ? "An email was sent recently. Wait a few minutes before asking for another."
      : authMessage(err);
  }
});

el.verifySignout.addEventListener("click", async () => {
  await signOut(auth);
  location.reload();
});

// ---------- Delete my account ----------
el.deleteStart.addEventListener("click", () => {
  el.deleteForm.hidden = false;
  el.deleteStart.hidden = true;
  el.deletePassword.focus();
});

el.deleteCancel.addEventListener("click", () => {
  el.deleteForm.hidden = true;
  el.deleteStart.hidden = false;
  el.deletePassword.value = "";
  el.deleteMsg.textContent = "";
});

el.deleteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser || !store) return;
  const password = el.deletePassword.value;
  if (!password) { el.deleteMsg.textContent = "Enter your password to confirm."; return; }
  el.deleteConfirm.disabled = true;
  el.deleteMsg.textContent = "Deleting…";
  try {
    // Firebase requires a recent sign-in before deleting an account
    await reauthenticateWithCredential(currentUser, EmailAuthProvider.credential(currentUser.email, password));
    for (const d of Object.keys(timers)) clearTimeout(timers[d]);
    if (sharing?.code) await store.removeCopies(sharing.code);
    await store.deleteEverything();
    await deleteUser(currentUser);
    try { sessionStorage.setItem("health-log-deleted", "1"); } catch {}
    location.reload();
  } catch (err) {
    el.deleteConfirm.disabled = false;
    el.deleteMsg.textContent = ["auth/invalid-credential", "auth/wrong-password", "auth/missing-password"].includes(err?.code)
      ? "That password isn't right. Nothing was deleted."
      : err?.code?.startsWith("auth/") ? authMessage(err)
      : "Couldn't finish deleting. Check your connection and try again. Your account is still there.";
  }
});

// ---------- Install to home screen ----------
const INSTALL_KEY = "health-log-install-dismissed";
let installEvent = null;

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function setupInstallTip() {
  let dismissed = false;
  try { dismissed = localStorage.getItem(INSTALL_KEY) === "1"; } catch {}
  if (dismissed || isStandalone()) return;

  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  // In-app browsers (WhatsApp, Instagram, Facebook, LinkedIn…) can't install
  const inApp = /FBAN|FBAV|Instagram|LinkedInApp|WhatsApp|Line\//.test(ua) || (isIOS && !/Safari\//.test(ua));

  if (isIOS) {
    el.installText.textContent = inApp
      ? "Open this page in Safari first (use the menu or compass icon), then tap Share and Add to Home Screen."
      : "Tap the Share button, then Add to Home Screen.";
    el.installTip.hidden = false;
  } else if (isAndroid) {
    el.installText.textContent = inApp
      ? "Open this page in Chrome first, then use the menu (⋮) and tap Install app or Add to Home screen."
      : "Open the browser menu (⋮) and tap Install app or Add to Home screen.";
    el.installTip.hidden = false;
  }
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  let dismissed = false;
  try { dismissed = localStorage.getItem(INSTALL_KEY) === "1"; } catch {}
  if (dismissed) return;
  el.installText.textContent = "Open it like an app, straight from your home screen.";
  el.installBtn.hidden = false;
  el.installTip.hidden = false;
});

el.installBtn.addEventListener("click", async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => {});
  installEvent = null;
  el.installTip.hidden = true;
});

el.installClose.addEventListener("click", () => {
  el.installTip.hidden = true;
  try { localStorage.setItem(INSTALL_KEY, "1"); } catch {}
});

window.addEventListener("appinstalled", () => { el.installTip.hidden = true; });

setupInstallTip();

// ---------- Start ----------
render();

(() => {
  if (!firebaseConfig?.apiKey || firebaseConfig.apiKey.startsWith("PASTE")) {
    signedOut = true;
    auth_.form.hidden = true;
    document.querySelector(".auth-tabs").hidden = true;
    auth_.title.textContent = "Almost ready";
    auth_.intro.textContent = "This app isn't connected to its database yet. Add the Firebase settings in firebase-config.js.";
    render();
    return;
  }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  const db = getFirestore(app);
  let started = false;

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (started) { location.reload(); return; }
      signedOut = true;
      currentUser = null;
      render();
      let deleted = false;
      try { deleted = sessionStorage.getItem("health-log-deleted") === "1"; sessionStorage.removeItem("health-log-deleted"); } catch {}
      if (deleted) auth_.msg.textContent = "Your account and all its data were deleted.";
      return;
    }
    currentUser = user;
    const s = firestoreStore(db, user.uid);
    if (pendingProfile) {
      // Just created: save the profile and send the verification email
      const prof = pendingProfile;
      pendingProfile = null;
      profile = { ...prof, cycle: null };
      try { await s.saveProfile(prof); } catch {}
      try { await sendEmailVerification(user, { url: appUrl() }); } catch {}
    }
    if (!user.emailVerified) { showVerify(user); return; }
    startApp(user);
  });

  startApp = (user) => {
    if (started) return;
    started = true;
    signedOut = false;
    el.verifyPanel.hidden = true;
    me = { email: user.email || "" };
    start(firestoreStore(db, user.uid));
    render();
  };
})();
