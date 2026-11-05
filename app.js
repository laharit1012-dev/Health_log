// =====================================================================
// Health Log: each person signs up with email and password and logs their
// own daily steps, water, sleep, workout and food. Logs are private;
// a share code lets someone else view (never change) your log.
// Login and storage: Firebase Authentication + Cloud Firestore.
// =====================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, sendEmailVerification, reload,
  EmailAuthProvider, reauthenticateWithCredential, deleteUser,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, collection, onSnapshot, setDoc, getDoc, getDocs, deleteDoc, query, where, arrayUnion, arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getMessaging, getToken, isSupported as messagingSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { firebaseConfig, vapidKey } from "./firebase-config.js?v=27";
import { cyclePhase, PHASES } from "./reminders/schedule.mjs?v=27";

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
// Starter goals; each person can set their own (stored in users/<uid>.goals)
const DEFAULT_GOALS = { steps: 10000, water: 8, sleep: 8, workout: 30 };
const goalsFor = (g) => ({ ...DEFAULT_GOALS, ...(g || {}) });
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
  if (!whole) return `${mins}m`;
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
      ? { name: d.name || "", gender: d.gender || "", cycle: d.cycle || null, goals: d.goals || null, reminders: d.reminders || null, groups: Array.isArray(d.groups) ? d.groups : [], xpDays: d.xpDays || {}, badges: d.badges || {} }
      : null, m), onError),
    watchSharing: (cb, onError) => watch(userRef, (d, m) => cb(d?.shareCode ? { code: d.shareCode, cycle: !!d.shareCycle } : null, m), onError),
    watchLinks: (cb, onError) => watch(userRef, (d, m) => cb({ people: Array.isArray(d?.links) ? d.links : [] }, m), onError),
    watchDay: (date, cb, onError) => watch(dayRef(date), cb, onError),
    saveDay: (log) => setDoc(dayRef(log.date), log),
    saveName: (name) => mergeUser({ name }),
    saveProfile: (changes) => mergeUser(changes),       // { name?, gender? }
    saveCycle: (cycle) => mergeUser({ cycle }),         // private: never copied to shares
    // Reminder settings; the token lets the reminder job reach this device
    saveReminders: (reminders, device) => mergeUser({
      reminders,
      remindersOn: !!(reminders.water?.on || reminders.workout?.on),
      ...(device ? { pushTokens: arrayUnion(device) } : {}),
    }),
    removeDevice: (device) => mergeUser({ pushTokens: arrayRemove(device) }),

    // Groups: groups/<code> { owner, name }, groups/<code>/members/<uid> { name, days }
    uid,
    saveGroups: (groups) => mergeUser({ groups }),
    saveXP: (xpDays) => mergeUser({ xpDays }),          // { date: xp } merged in
    saveBadges: (badges) => mergeUser({ badges }),      // { id: date earned } merged in
    async getGroup(code) {
      try {
        const snap = await getDoc(doc(db, "groups", code));
        return snap.exists() ? snap.data() : null;
      } catch (err) {
        if (err?.code === "permission-denied") return null;
        throw err;
      }
    },
    createGroup: (code, name) => setDoc(doc(db, "groups", code), { owner: uid, name, createdAt: Date.now() }),
    saveMember: (code, data) => setDoc(doc(db, "groups", code, "members", uid), data),
    leaveGroup: (code) => deleteDoc(doc(db, "groups", code, "members", uid)),
    removeMember: (code, memberUid) => deleteDoc(doc(db, "groups", code, "members", memberUid)),
    async deleteGroup(code) {
      const snap = await getDocs(collection(db, "groups", code, "members"));
      for (const d of snap.docs) if (d.id !== uid) await deleteDoc(d.ref);
      await deleteDoc(doc(db, "groups", code, "members", uid)).catch(() => {});
      await deleteDoc(doc(db, "groups", code));
    },
    watchGroup: (code, cb, onError) => watch(doc(db, "groups", code), cb, onError),
    watchGroupMembers: (code, cb, onError) => onSnapshot(collection(db, "groups", code, "members"),
      (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => onError?.(err)),
    saveSharing: (code, shareCycle = false) => mergeUser({ shareCode: code, shareCycle }),
    // cycleWatchOn tells the reminder job to check this person's cycle updates
    saveLinks: (people, device) => mergeUser({
      links: people,
      cycleWatchOn: people.some((p) => p.cycleUpdates),
      ...(device ? { pushTokens: arrayUnion(device) } : {}),
    }),

    // Copies kept for people you share with
    mirrorDay: (code, log) => setDoc(shareDayRef(code, log.date), log),
    // The shared header: name, plus period data only if she chose to share it
    mirrorProfile: (code, name, cycle, goals) =>
      setDoc(shareRef(code), { owner: uid, name, cycle: cycle || null, goals: goals || null }),
    // Recent days, for the step streak
    async daysSince(fromISO) {
      const snap = await getDocs(query(collection(db, "users", uid, "days"), where("date", ">=", fromISO)));
      return snap.docs.map((d) => d.data());
    },
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
let viewGoals = null;      // their goals
let recent = null;         // { date: steps } for the last 60 days, for the streak
let recentLogs = null;     // { date: log } for the last 60 days, for group insights
let viewGone = false;      // the linked person stopped sharing
let pendingShare = false;  // create a code as soon as a name is saved

const logNow = () => (viewing ? normalize(dayLog, date) : drafts[date] || normalize(dayLog, date));
const displayName = () => profile?.name || "";
const isFemale = () => profile?.gender === "female";
const goalsNow = () => goalsFor(viewing ? viewGoals : profile?.goals);

// Which goals a day's log has reached
function metFlags(log, g) {
  const hours = sleepHours(log.sleep.bed, log.sleep.wake);
  return {
    steps: (log.steps || 0) >= g.steps,
    water: log.water >= g.water,
    sleep: hours != null && hours >= g.sleep,
    workout: workoutMinutes(log) >= g.workout,
  };
}
let dayReady = false;      // the log for `date` has arrived; editing before that could overwrite it
const readOnly = () => !!blocked || !!viewing || !store || !dayReady;

// ---------- Saving (debounced, one write at a time per day) ----------
const timers = {};
const chains = {};
let saving = 0;

function edit(mutate) {
  if (readOnly()) return;
  const before = metFlags(logNow(), goalsNow());
  const log = structuredClone(logNow());
  mutate(log);
  const after = metFlags(log, goalsNow());
  const reached = Object.keys(after).filter((k) => after[k] && !before[k]);
  if (reached.length) celebrate(reached, log);
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
    .then(() => {
      if (recent) recent[log.date] = log.steps || 0;
      if (recentLogs) { recentLogs[log.date] = log; syncGroups(); updateProgress(log.date); }
      if (drafts[d] === log) delete drafts[d];
    })
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
  wList: $("workout-list"), wBar: $("workout-bar"), wTotal: $("workout-total"), wMsg: $("workout-msg"),
  foodForm: $("food-form"), foodMeal: $("food-meal"), foodItem: $("food-item"), foodCal: $("food-cal"),
  foodList: $("food-list"), foodTotal: $("food-total"),
  nudgeText: $("nudge-text"), streak: $("streak"), streakText: $("streak-text"),
  goalsText: $("goals-text"), goalsEdit: $("goals-edit"), goalsForm: $("goals-form"), goalsMsg: $("goals-msg"),
  goalSteps: $("goal-steps"), goalWater: $("goal-water"), goalSleep: $("goal-sleep"), goalWorkout: $("goal-workout"),
  goalsCancel: $("goals-cancel"), toast: $("toast"), confetti: $("confetti"),
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
  remPanel: $("reminders-panel"), remNote: $("rem-note"), remBody: $("rem-body"), remMsg: $("rem-msg"), remTest: $("rem-test"),
  remWaterOn: $("rem-water-on"), remWaterFrom: $("rem-water-from"), remWaterTo: $("rem-water-to"), remWaterEvery: $("rem-water-every"),
  remWorkoutOn: $("rem-workout-on"), remWorkoutTime: $("rem-workout-time"),
  groupsPanel: $("groups-panel"), groupsListView: $("groups-list-view"), groupList: $("group-list"),
  groupCreateForm: $("group-create-form"), groupName: $("group-name"), groupJoinForm: $("group-join-form"), groupCode: $("group-code"),
  groupsMsg: $("groups-msg"), groupDetail: $("group-detail-view"), groupBack: $("group-back"), groupTitle: $("group-title"),
  groupCount: $("group-count"), groupNote: $("group-note"), groupMembers: $("group-members"), groupInvite: $("group-invite-code"),
  groupCopy: $("group-copy"), groupLeave: $("group-leave"), groupLeaveConfirm: $("group-leave-confirm"), groupLeaveText: $("group-leave-text"),
  groupLeaveYes: $("group-leave-yes"), groupLeaveNo: $("group-leave-no"), groupMsg: $("group-msg"),
  watchAsk: $("watch-ask"), watchAskTitle: $("watch-ask-title"), watchAskText: $("watch-ask-text"),
  watchYes: $("watch-yes"), watchNo: $("watch-no"), watchMsg: $("watch-msg"),
  cyclePhaseBox: $("cycle-phase"), cyclePhaseName: $("cycle-phase-name"), cyclePhaseNote: $("cycle-phase-note"),
  remCycle: $("rem-cycle"), remCycleList: $("rem-cycle-list"),
  levelCard: $("level-card"), levelNum: $("level-num"), levelName: $("level-name"), levelBar: $("level-bar"),
  levelHint: $("level-hint"), todayRing: $("today-ring"),
  badgesPanel: $("badges-panel"), badgesCount: $("badges-count"), badgeGrid: $("badge-grid"),
  tabbar: $("tabbar"), tabPeriod: $("tab-period"), periodPanel: $("period-panel"),
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

// ---------- Pages ----------
const ROUTES = ["today", "cycle", "family", "reminders", "account"];
const routeFromHash = () => {
  let r = location.hash.replace("#", "");
  if (r === "period") r = "cycle"; // older links
  return ROUTES.includes(r) ? r : "today";
};
let route = routeFromHash();

function goTo(r) {
  if (location.hash !== "#" + r) location.hash = r; // fires hashchange
  else { route = r; render(); }
}

window.addEventListener("hashchange", () => {
  route = routeFromHash();
  if (route !== "family" && openGroup) closeGroupView();
  render();
  window.scrollTo(0, 0);
});

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
  const inApp = !signedOut && !!store;
  // Cycle page: women, or when viewing someone who shared their cycle tracker
  const periodAvailable = viewing ? !!viewCycle : isFemale();
  if (route === "cycle" && inApp && !periodAvailable && profile) {
    route = "today";
    history.replaceState(null, "", "#today");
  }
  el.tabPeriod.hidden = !periodAvailable;
  const on = (r) => inApp && route === r;
  el.tabbar.hidden = !inApp;
  document.body.dataset.route = inApp ? route : "signin";
  el.installTip.hidden = !(installWanted && (!inApp || route === "today"));
  document.body.classList.toggle("has-tabbar", inApp);
  for (const a of el.tabbar.querySelectorAll("a")) {
    if (a.dataset.route === route) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  el.dayBar.hidden = !on("today");
  el.summaryPanel.hidden = !on("today");
  el.badgesPanel.hidden = !on("today") || !!viewing;
  el.panel.hidden = !on("today");
  el.periodPanel.hidden = !on("cycle");
  el.linkPanel.hidden = !on("family") || !store?.canLink || !!blocked;
  el.groupsPanel.hidden = !on("family") || !store?.canLink || !!blocked;
  el.accountPanel.hidden = !on("account");
  el.remPanel.hidden = !on("reminders") || !!blocked;
  if (me) el.accountEmail.textContent = me.email;
  el.people.hidden = !(on("today") || on("cycle")) || links.length === 0;
  const viewedLink = viewing ? links.find((l) => l.code === viewing) : null;
  el.watchAsk.hidden = !(on("today") || on("cycle")) || !viewedLink || !viewCycle || viewedLink.cycleAsked === true;
  if (!el.watchAsk.hidden) {
    const n = viewName || viewedLink.name || "They";
    el.watchAskTitle.textContent = `Get cycle updates for ${n}?`;
    el.watchAskText.textContent = `${n} shares their cycle tracker with you. You'll get a notification when their cycle phase changes, with how they may be feeling and ways to support them.`;
  }
  el.watchMsg.hidden = !(on("today") || on("cycle")) || !el.watchMsg.textContent;
  if (signedOut || !store) return;

  renderPeople();
  renderSummary();
  renderGoals();
  renderNudge();
  renderReminders();
  renderCycle();
  renderGroups();
  renderProgress();
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
      ? "Cycle tracker: shared with people who have your code. They can choose to get phase updates."
      : "Cycle tracker: private. People with your code don't see it.";
    el.shareCycleToggle.textContent = sharing.cycle ? "Stop sharing cycle tracker" : "Share cycle tracker too";
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
    view.addEventListener("click", () => { viewPerson(p.code); goTo("today"); });
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

  const met = metFlags(log, goalsNow());
  const g = goalsNow();
  const addStat = (label, value, unit, isMet) => {
    const wrap = document.createElement("div");
    wrap.className = "stat" + (isMet ? " is-met" : "");
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

  addStat("Steps", log.steps != null ? fmt(log.steps) : "—", `/ ${fmt(g.steps)}`, met.steps);
  addStat("Water", String(log.water), `/ ${g.water} glasses`, met.water);
  addStat("Sleep", formatHours(hours), `/ ${g.sleep} h`, met.sleep);
  const wMins = workoutMinutes(log);
  addStat("Workouts", wMins ? `${fmt(wMins)} min` : "—", `/ ${g.workout} min`, met.workout);
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

// ---------- Goals, encouragement and streak ----------
function goalsLine(g) {
  return `${fmt(g.steps)} steps · ${g.water} glasses · ${g.sleep} h sleep · ${g.workout} min workout`;
}

function renderGoals() {
  const g = goalsNow();
  if (viewing) {
    el.goalsText.textContent = `${viewName || "Their"}'s goals: ${goalsLine(g)}`;
    el.goalsEdit.hidden = true;
    el.goalsForm.hidden = true;
    return;
  }
  el.goalsText.textContent = profile?.goals
    ? `Your goals: ${goalsLine(g)}`
    : `Starter goals: ${goalsLine(g)}. Make them yours!`;
  el.goalsEdit.hidden = readOnly() || !el.goalsForm.hidden;
}

function streakCount() {
  if (!recent || viewing) return { days: 0, todayDone: false };
  const goal = goalsFor(profile?.goals).steps;
  const today = todayISO();
  const todaySteps = date === today ? (logNow().steps || 0) : (recent[today] || 0);
  const todayDone = todaySteps >= goal;
  let days = todayDone ? 1 : 0;
  for (let d = shiftDate(today, -1); (recent[d] || 0) >= goal; d = shiftDate(d, -1)) days++;
  return { days, todayDone };
}

function renderNudge() {
  const log = logNow();
  const g = goalsNow();
  const met = metFlags(log, g);
  const count = Object.values(met).filter(Boolean).length;

  // Streak chip (your own log only)
  const st = streakCount();
  el.streak.hidden = st.days === 0;
  if (st.days) el.streakText.textContent = `${st.days}-day step streak`;

  if (viewing) {
    el.nudgeText.textContent = `${viewName || "They"} reached ${count} of 4 goals ${date === todayISO() ? "today" : "this day"}.`;
    return;
  }
  if (date !== todayISO()) {
    el.nudgeText.textContent = count === 4 ? "Every goal reached this day. Nice!" : `${count} of 4 goals reached this day.`;
    return;
  }
  if (count === 4) {
    el.nudgeText.textContent = "You reached every goal today. Amazing work!";
    return;
  }
  // Suggest the goal that's closest to done
  const options = [];
  const steps = log.steps || 0;
  if (!met.steps) {
    const left = g.steps - steps;
    const mins = Math.max(5, Math.ceil(left / 100)); // about 100 steps a minute
    const walk = mins < 60 ? `about a ${mins}-minute walk` : `about ${formatHours(mins / 60)} of walking`;
    options.push({ p: steps / g.steps, text: `${fmt(left)} steps to go, ${walk}.` });
  }
  if (!met.water) {
    const left = g.water - log.water;
    options.push({ p: log.water / g.water, text: `${left} more glass${left === 1 ? "" : "es"} of water to reach your goal.` });
  }
  if (!met.workout) {
    const left = g.workout - workoutMinutes(log);
    options.push({ p: workoutMinutes(log) / g.workout, text: `${left} more workout minute${left === 1 ? "" : "s"} to hit your goal. Even a quick walk counts!` });
  }
  if (!met.sleep) {
    const hours = sleepHours(log.sleep.bed, log.sleep.wake);
    options.push({ p: (hours || 0) / g.sleep - 0.01, text: hours == null
      ? `Log last night's sleep. Your goal is ${g.sleep} hours.`
      : `Aim for ${g.sleep} hours of sleep tonight.` });
  }
  options.sort((a, b) => b.p - a.p);
  const keepStreak = st.days > 0 && !st.todayDone ? ` Reach your step goal today to keep your ${st.days}-day streak going.` : "";
  el.nudgeText.textContent = (options[0]?.text || `${count} of 4 goals reached today.`) + (met.steps ? "" : keepStreak);
}

el.goalsEdit.addEventListener("click", () => {
  const g = goalsFor(profile?.goals);
  el.goalSteps.value = g.steps;
  el.goalWater.value = g.water;
  el.goalSleep.value = g.sleep;
  el.goalWorkout.value = g.workout;
  el.goalsMsg.textContent = "";
  el.goalsForm.hidden = false;
  render();
  el.goalSteps.focus();
});

el.goalsCancel.addEventListener("click", () => { el.goalsForm.hidden = true; render(); });

el.goalsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const num = (input) => Number(input.value);
  const goals = {
    steps: Math.round(num(el.goalSteps)),
    water: Math.round(num(el.goalWater)),
    sleep: Math.round(num(el.goalSleep) * 2) / 2,
    workout: Math.round(num(el.goalWorkout)),
  };
  const bad =
    !(goals.steps >= 500 && goals.steps <= 100000) ? "Steps: pick a number between 500 and 100,000." :
    !(goals.water >= 1 && goals.water <= 30) ? "Water: pick between 1 and 30 glasses." :
    !(goals.sleep >= 3 && goals.sleep <= 14) ? "Sleep: pick between 3 and 14 hours." :
    !(goals.workout >= 5 && goals.workout <= 600) ? "Workout: pick between 5 and 600 minutes." : "";
  if (bad) { el.goalsMsg.textContent = bad; return; }
  el.goalsForm.hidden = true;
  profile = { ...(profile || {}), goals };
  render();
  showToast("Goals saved. You've got this!");
  try {
    await store.saveProfile({ goals });
    await syncShareProfile();
    syncGroups();
    updateProgress(null, { quiet: true });
  } catch (err) {
    handleWriteError(err);
    render();
  }
});

// ---------- Celebrations ----------
let toastTimer = null;
const toastQueue = [];
function showToast(text) {
  toastQueue.push(text);
  if (toastQueue.length === 1) nextToast();
}
function nextToast() {
  if (!toastQueue.length) return;
  el.toast.textContent = toastQueue[0];
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
    toastQueue.shift();
    if (toastQueue.length) setTimeout(nextToast, 250);
  }, 2800);
}

function celebrate(keys, log) {
  const g = goalsNow();
  const words = {
    steps: `Step goal reached: ${fmt(log.steps || 0)} steps!`,
    water: "Water goal reached. Nicely hydrated!",
    workout: `Workout goal done: ${fmt(workoutMinutes(log))} minutes!`,
    sleep: `You hit your ${g.sleep}-hour sleep goal!`,
  };
  const all = Object.values(metFlags(log, g)).every(Boolean);
  showToast(all ? "Every goal reached today. Amazing!" : words[keys[0]]);
  burstConfetti();
}

function burstConfetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = el.confetti;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const colors = [css.getPropertyValue("--accent"), css.getPropertyValue("--warm"), "#FDE68A", "#5CC4B5", "#F97066"];
  const pieces = Array.from({ length: 110 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80,
    y: innerHeight * 0.6,
    vx: (Math.random() - 0.5) * 12,
    vy: -8 - Math.random() * 9,
    size: 5 + Math.random() * 6,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)].trim() || "#0F766E",
  }));
  const startT = performance.now();
  const frame = (t) => {
    const elapsed = t - startT;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of pieces) {
      p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vx *= 0.99;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - elapsed / 1800);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      ctx.restore();
    }
    if (elapsed < 1800) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(frame);
}

async function loadRecent() {
  if (!store?.daysSince) return;
  try {
    const days = await store.daysSince(shiftDate(todayISO(), -60));
    recent = Object.fromEntries(days.map((d) => [d.date, d.steps || 0]));
    recentLogs = Object.fromEntries(days.map((d) => [d.date, d]));
    render();
    syncGroups();
    initProgress();
  } catch { recent = null; }
}

function renderWorkouts(log) {
  const mins = workoutMinutes(log);
  const n = log.workouts.length;
  const goal = goalsNow().workout;
  el.wTotal.textContent = n
    ? `${n} workout${n === 1 ? "" : "s"} · ${fmt(mins)} of ${goal} min`
    : `Goal ${goal} min`;
  el.wBar.style.width = Math.min(100, (mins / goal) * 100) + "%";
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
  const show = !el.periodPanel.hidden && (viewing ? !!viewCycle : isFemale());
  if (!show) return;
  const date = todayISO(); // the Cycle page is always about today

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

  const ph = cyclePhase(cycle, todayISO());
  el.cyclePhaseBox.hidden = !ph;
  if (ph) {
    el.cyclePhaseName.textContent = PHASES[ph.phase].name;
    el.cyclePhaseNote.textContent = ph.phase === "late" && !viewing
      ? "Your next period is due around now."
      : PHASES[ph.phase].note;
  }

  el.cycleDate.max = todayISO();
  if (!el.cycleDate.value) el.cycleDate.value = todayISO();
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
  const g = goalsNow();
  el.stepsBar.style.width = Math.min(100, ((log.steps || 0) / g.steps) * 100) + "%";
  el.stepsHint.textContent = (log.steps || 0) >= g.steps
    ? `Goal of ${fmt(g.steps)} reached`
    : `${fmt(Math.max(0, g.steps - (log.steps || 0)))} to go · goal ${fmt(g.steps)}`;

  // Water
  el.waterCount.textContent = log.water;
  el.waterMinus.disabled = log.water <= 0;
  el.waterBar.style.width = Math.min(100, (log.water / g.water) * 100) + "%";
  el.waterHint.textContent = log.water >= g.water
    ? `${fmt(log.water * GLASS_ML)} ml · goal of ${g.water} glasses reached`
    : `${fmt(log.water * GLASS_ML)} ml · ${g.water - log.water} more to reach ${g.water} glasses`;

  // Sleep
  setValue(el.bed, log.sleep.bed);
  setValue(el.wake, log.sleep.wake);
  const hours = sleepHours(log.sleep.bed, log.sleep.wake);
  if (hours == null) el.sleepHint.textContent = `Goal ${g.sleep} hours`;
  else if (hours >= g.sleep) el.sleepHint.textContent = `${formatHours(hours)} of sleep · goal of ${g.sleep}h reached`;
  else el.sleepHint.textContent = `${formatHours(hours)} of sleep · ${formatHours(g.sleep - hours)} short of your ${g.sleep}h goal`;


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
      syncGroups();
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
  return store.mirrorProfile(sharing.code, displayName(), cycle, profile?.goals || null).catch(() => {});
}

let shareCycleChoice = null; // her answer to "Share your cycle tracker too?"

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
    goTo("today");
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
    await store.mirrorProfile(code, name, withCycle ? (profile?.cycle || { starts: [], length: null }) : null, profile?.goals || null);
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
      ? "Your cycle tracker is now shared with people who have your code."
      : "Your cycle tracker is private again. People with your code no longer see it.";
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
    goTo("today");
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
  el.watchMsg.textContent = "";
  viewing = code;
  viewGone = false;
  if (unwatchViewProfile) { unwatchViewProfile(); unwatchViewProfile = null; }
  if (code) {
    viewName = links.find((p) => p.code === code)?.name || "";
    viewCycle = null;
    unwatchViewProfile = store.watchSharedProfile(code, (p, meta) => {
      if (p) { viewName = p.name || viewName; viewCycle = p.cycle || null; viewGoals = p.goals || null; viewGone = false; }
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
  store.watchProfile((p) => { profile = p; render(); initProgress(); }, () => {});
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
  await forgetThisDevice();
  await signOut(auth);
  location.reload(); // start clean so nothing from this account stays on screen
});

// ---------- Reminders ----------
const DEFAULT_REMINDERS = {
  water: { on: false, from: "09:00", to: "21:00", every: 2 },
  workout: { on: false, time: "18:00" },
};
const PUSH_KEY = "health-log-push";
let fbApp = null;
let pushState = "checking";   // ok | needs-install | unsupported | not-ready | checking

const isIOSDevice = () => /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function remindersNow() {
  const r = profile?.reminders || {};
  return {
    water: { ...DEFAULT_REMINDERS.water, ...(r.water || {}) },
    workout: { ...DEFAULT_REMINDERS.workout, ...(r.workout || {}) },
  };
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Browser";
}

async function checkPush() {
  if (!vapidKey || vapidKey.startsWith("PASTE")) return "not-ready";
  if (isIOSDevice() && !isStandalone()) return "needs-install";
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return isIOSDevice() ? "needs-install" : "unsupported";
  try { return (await messagingSupported()) ? "ok" : "unsupported"; } catch { return "unsupported"; }
}

const remNotes = {
  "needs-install": "On iPhone and iPad, reminders work when Health Log is on your Home Screen. In Safari, tap Share, then Add to Home Screen (keep Open as Web App on). Open Health Log from that icon and turn reminders on there.",
  unsupported: "This browser can't show reminders. Try Chrome on Android, or Health Log from your iPhone Home Screen.",
  "not-ready": "Reminders are almost ready. This section will switch on soon.",
  checking: "",
};

function renderReminders() {
  if (el.remPanel.hidden) return;
  renderCycleUpdates();
  const r = remindersNow();
  const ok = pushState === "ok";
  el.remNote.hidden = ok || pushState === "checking";
  el.remNote.textContent = remNotes[pushState] || "";
  el.remWaterOn.checked = ok && r.water.on;
  el.remWorkoutOn.checked = ok && r.workout.on;
  setValue(el.remWaterFrom, r.water.from);
  setValue(el.remWaterTo, r.water.to);
  setValue(el.remWaterEvery, String(r.water.every));
  setValue(el.remWorkoutTime, r.workout.time);
  for (const c of [el.remWaterOn, el.remWaterFrom, el.remWaterTo, el.remWaterEvery, el.remWorkoutOn, el.remWorkoutTime]) c.disabled = !ok;
  el.remTest.hidden = !(ok && "Notification" in window && Notification.permission === "granted");
}

async function deviceToken() {
  if (Notification.permission === "denied") throw { code: "denied" };
  if (Notification.permission !== "granted") {
    const answer = await Notification.requestPermission();
    if (answer !== "granted") throw { code: "denied" };
  }
  const reg = await navigator.serviceWorker.register("firebase-messaging-sw.js", { scope: "./" });
  const token = await getToken(getMessaging(fbApp), { vapidKey, serviceWorkerRegistration: reg });
  if (!token) throw { code: "no-token" };
  const device = { token, device: deviceName() };
  try { localStorage.setItem(PUSH_KEY, JSON.stringify({ uid: currentUser?.uid, ...device })); } catch {}
  return device;
}

async function saveReminders(r, device) {
  const reminders = { ...r, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" };
  profile = { ...(profile || {}), reminders };
  render();
  await store.saveReminders(reminders, device);
}

async function toggleReminder(kind, input) {
  if (blocked || !store || pushState !== "ok") return;
  const before = profile?.reminders || null;
  const r = remindersNow();
  r[kind].on = input.checked;
  profile = { ...(profile || {}), reminders: { ...r, tz: before?.tz } }; // show the change right away
  render();
  let device = null;
  if (input.checked) {
    el.remMsg.textContent = "Turning on reminders…";
    try {
      device = await deviceToken();
    } catch (err) {
      profile = { ...(profile || {}), reminders: before };
      render();
      el.remMsg.textContent = err?.code === "denied"
        ? (isIOSDevice()
          ? "Notifications are off for Health Log. Turn them on in Settings, Notifications, Health Log, then try again."
          : "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.")
        : "Couldn't turn on reminders on this device. Check your connection and try again.";
      return;
    }
  }
  try {
    await saveReminders(r, device);
    const what = kind === "water" ? "Water" : "Workout";
    el.remMsg.textContent = input.checked ? `${what} reminders are on for this device.` : `${what} reminders are off.`;
  } catch (err) {
    handleWriteError(err);
    el.remMsg.textContent = "Couldn't save. Check your connection and try again.";
  }
}

el.remWaterOn.addEventListener("change", () => toggleReminder("water", el.remWaterOn));
el.remWorkoutOn.addEventListener("change", () => toggleReminder("workout", el.remWorkoutOn));

let remTimer = null;
function onReminderField() {
  clearTimeout(remTimer);
  remTimer = setTimeout(async () => {
    const r = remindersNow();
    r.water.from = el.remWaterFrom.value || r.water.from;
    r.water.to = el.remWaterTo.value || r.water.to;
    r.water.every = Number(el.remWaterEvery.value) || r.water.every;
    r.workout.time = el.remWorkoutTime.value || r.workout.time;
    if (r.water.to <= r.water.from) {
      el.remMsg.textContent = "Water reminders: the end time needs to be after the start time.";
      return;
    }
    try {
      await saveReminders(r, null);
      el.remMsg.textContent = "Reminder times saved.";
    } catch (err) { handleWriteError(err); }
  }, 600);
}
for (const c of [el.remWaterFrom, el.remWaterTo, el.remWaterEvery, el.remWorkoutTime]) c.addEventListener("change", onReminderField);

el.remTest.addEventListener("click", async () => {
  try {
    const reg = await navigator.serviceWorker.getRegistration("./") || await navigator.serviceWorker.register("firebase-messaging-sw.js", { scope: "./" });
    await reg.showNotification("Health Log", { body: "Reminders are working on this device.", icon: "icons/icon-192.png" });
    el.remMsg.textContent = "Test notification sent. If you didn't see it, check your phone's notification settings.";
  } catch {
    el.remMsg.textContent = "Couldn't show a test notification on this device.";
  }
});

// On sign-out, stop sending this person's reminders to this device
async function forgetThisDevice() {
  try {
    const saved = JSON.parse(localStorage.getItem(PUSH_KEY) || "null");
    if (saved && saved.uid === currentUser?.uid && store) {
      await store.removeDevice({ token: saved.token, device: saved.device });
    }
    localStorage.removeItem(PUSH_KEY);
  } catch {}
}

// ---------- Points, levels and badges ----------
const LEVELS = [
  [0, "Starter"], [100, "Walker"], [300, "Mover"], [600, "Hiker"], [1000, "Runner"],
  [1500, "Climber"], [2100, "Athlete"], [2800, "Champion"], [3600, "Hero"], [4500, "Legend"],
];

function levelFor(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i++;
  return { level: i + 1, name: LEVELS[i][1], floor: LEVELS[i][0], next: LEVELS[i + 1]?.[0] ?? null };
}

// Points for one day: +10 for logging anything, +20 per goal reached, +10 for food, +30 for a perfect day
function dayXP(log, g) {
  const n = normalize(log, log?.date);
  const any = n.steps || n.water || n.foods.length || n.workouts.length || n.sleep.bed || n.sleep.wake;
  if (!any) return 0;
  const m = metFlags(n, g);
  const goalsHit = [m.steps, m.water, m.sleep, m.workout].filter(Boolean).length;
  return 10 + 20 * goalsHit + (n.foods.length ? 10 : 0) + (goalsHit === 4 ? 30 : 0);
}

const totalXP = () => Object.values(profile?.xpDays || {}).reduce((a, b) => a + (Number(b) || 0), 0);

const BADGES = [
  { id: "first", glyph: "1st", name: "First step", how: "Log anything" },
  { id: "tenk", glyph: "10K", name: "10K club", how: "10,000 steps in a day" },
  { id: "perfect", glyph: "★", name: "Perfect day", how: "All 4 goals in one day" },
  { id: "streak3", glyph: "3d", name: "On a roll", how: "3-day step streak" },
  { id: "streak7", glyph: "7d", name: "Week warrior", how: "7-day step streak" },
  { id: "streak30", glyph: "30d", name: "Unstoppable", how: "30-day step streak" },
  { id: "hydrate", glyph: "H₂O", name: "Hydration hero", how: "Water goal on 7 days" },
  { id: "workout5", glyph: "5×", name: "Workout warrior", how: "5 workouts in 7 days" },
  { id: "sleep5", glyph: "Zz", name: "Well rested", how: "Sleep goal 5 nights in a row" },
  { id: "marathon", glyph: "42K", name: "Marathon week", how: "55,000 steps in 7 days" },
  { id: "team", glyph: "+", name: "Team player", how: "Join or create a group" },
  { id: "level5", glyph: "L5", name: "Runner rank", how: "Reach Level 5" },
  { id: "champion", glyph: "#1", name: "Group champion", how: "Most points in a group" },
];

// All your days we know about (last 60 days plus unsaved edits)
function knownDays() {
  const days = { ...(recentLogs || {}) };
  for (const [d, log] of Object.entries(drafts)) days[d] = log;
  return Object.keys(days).sort().map((d) => normalize({ ...days[d], date: d }, d));
}

function earnedNow() {
  const g = goalsFor(profile?.goals);
  const days = knownDays();
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  const met = (d) => metFlags(d, g);
  const longestRun = (test) => {
    let best = 0, run = 0, prev = null;
    for (const d of days) {
      const ok = test(d);
      run = ok && prev && shiftDate(prev, 1) === d.date ? run + 1 : ok ? 1 : 0;
      best = Math.max(best, run);
      prev = d.date;
    }
    return best;
  };
  const windowSum = (fn) => {
    let best = 0;
    for (const d of days) {
      let sum = 0;
      for (let i = 0; i < 7; i++) { const x = byDate[shiftDate(d.date, i)]; if (x) sum += fn(x); }
      best = Math.max(best, sum);
    }
    return best;
  };
  const stepRun = longestRun((d) => met(d).steps);
  const out = new Set();
  if (days.some((d) => dayXP(d, g) > 0)) out.add("first");
  if (days.some((d) => (d.steps || 0) >= 10000)) out.add("tenk");
  if (days.some((d) => Object.values(met(d)).every(Boolean))) out.add("perfect");
  if (stepRun >= 3) out.add("streak3");
  if (stepRun >= 7) out.add("streak7");
  if (stepRun >= 30) out.add("streak30");
  if (days.filter((d) => met(d).water).length >= 7) out.add("hydrate");
  if (windowSum((d) => d.workouts.length) >= 5) out.add("workout5");
  if (longestRun((d) => met(d).sleep) >= 5) out.add("sleep5");
  if (windowSum((d) => d.steps || 0) >= 55000) out.add("marathon");
  if ((profile?.groups || []).length) out.add("team");
  if (levelFor(totalXP()).level >= 5) out.add("level5");
  return out;
}

// First full calculation once both your profile and recent days have loaded
let progressReady = false;
function initProgress() {
  if (progressReady || !profile || !recentLogs) return;
  progressReady = true;
  updateProgress(null, { quiet: true });
}

// Recalculate points (for one day, or all known days) and award new badges
let progressBusy = false;
async function updateProgress(onlyDate, { quiet = false } = {}) {
  if (!store?.saveXP || !recentLogs || !profile || progressBusy) return;
  progressBusy = true;
  try {
    const g = goalsFor(profile.goals);
    const before = levelFor(totalXP());
    const changes = {};
    for (const d of knownDays()) {
      if (onlyDate && d.date !== onlyDate) continue;
      const xp = dayXP(d, g);
      if ((profile.xpDays?.[d.date] || 0) !== xp) changes[d.date] = xp;
    }
    if (Object.keys(changes).length) {
      profile = { ...profile, xpDays: { ...(profile.xpDays || {}), ...changes } };
      await store.saveXP(changes).catch(() => {});
      syncGroups(); // so groups see your new points
    }
    const after = levelFor(totalXP());
    if (!quiet && after.level > before.level) {
      showToast(`Level up! You're now Level ${after.level} · ${after.name}`);
      burstConfetti();
    }
    await awardBadges([...earnedNow()]);
    render();
  } finally {
    progressBusy = false;
  }
}

async function awardBadges(ids) {
  const have = profile?.badges || {};
  const fresh = ids.filter((id) => !have[id]);
  if (!fresh.length || !store?.saveBadges) return;
  const stamp = Object.fromEntries(fresh.map((id) => [id, todayISO()]));
  profile = { ...profile, badges: { ...have, ...stamp } };
  await store.saveBadges(stamp).catch(() => {});
  for (const id of fresh) showToast(`Badge unlocked: ${BADGES.find((b) => b.id === id).name}!`);
  burstConfetti();
  render();
}

function renderProgress() {
  const show = !viewing && !el.summaryPanel.hidden && !!profile;
  el.levelCard.hidden = !show;
  if (show) {
    const xp = totalXP();
    const lv = levelFor(xp);
    const todayXP = dayXP(logNow(), goalsNow());
    el.levelNum.textContent = fmt(xp);
    el.levelName.textContent = `Level ${lv.level} · ${lv.name}`;
    el.levelBar.style.width = lv.next ? Math.round(((xp - lv.floor) / (lv.next - lv.floor)) * 100) + "%" : "100%";
    el.levelHint.textContent = (lv.next ? `${fmt(lv.next - xp)} points to Level ${lv.level + 1}` : "Top level reached!") +
      (date === todayISO() ? ` · +${todayXP} points today` : "");
    const sm = daySummary(logNow(), goalsNow());
    el.todayRing.replaceChildren(rateRing(activityRate(sm), date === todayISO() ? "today" : "this day"));
  }

  if (el.badgesPanel.hidden) return;
  const have = profile?.badges || {};
  el.badgesCount.textContent = `${Object.keys(have).filter((id) => BADGES.some((b) => b.id === id)).length} of ${BADGES.length}`;
  el.badgeGrid.replaceChildren();
  for (const b of BADGES) {
    const li = document.createElement("li");
    const got = !!have[b.id];
    li.className = "badge-tile" + (got ? "" : " is-locked");
    const medal = document.createElement("span");
    medal.className = "medal";
    medal.setAttribute("aria-hidden", "true");
    medal.textContent = b.glyph;
    const name = document.createElement("strong");
    name.textContent = b.name;
    const how = document.createElement("small");
    how.textContent = got ? `Earned ${shortDate(have[b.id])}` : b.how;
    li.setAttribute("aria-label", `${b.name}: ${got ? "earned" : "locked. " + b.how}`);
    li.append(medal, name, how);
    el.badgeGrid.append(li);
  }
}

// ---------- Groups ----------
// Each member keeps a small summary of their last 7 days in every group they're in.
// Shared: steps, workout minutes, sleep hours, food item count and calories, and goals.
// Not shared: what was eaten, notes, the cycle tracker.
let openGroup = null;        // code of the group being viewed
let groupInfo = null;        // { owner, name }
let groupMembers = [];
let groupLoaded = false;
let unwatchGroup = [];
let removeArmed = null;      // member id waiting for a second tap to remove

function daySummary(log, g) {
  const n = normalize(log, log?.date);
  return {
    st: n.steps || 0, stg: g.steps,
    wo: workoutMinutes(n), wog: g.workout,
    sl: sleepHours(n.sleep.bed, n.sleep.wake), slg: g.sleep,
    fd: n.foods.length, kc: caloriesOf(n),
  };
}

function memberData() {
  const g = goalsFor(profile?.goals);
  const days = {};
  for (let i = 6; i >= 0; i--) {
    const d = shiftDate(todayISO(), -i);
    const log = drafts[d] || recentLogs?.[d] || (d === date && dayLog ? dayLog : null);
    if (log) days[d] = daySummary({ ...log, date: d }, g);
  }
  return { name: displayName() || "Member", updatedAt: Date.now(), days, level: levelFor(totalXP()).level, points: totalXP() };
}

let groupSyncTimer = null;
function syncGroups() {
  if (!store?.saveMember || !recentLogs || !(profile?.groups || []).length) return;
  clearTimeout(groupSyncTimer);
  groupSyncTimer = setTimeout(async () => {
    const data = memberData();
    for (const grp of profile.groups) await store.saveMember(grp.code, data).catch(() => {});
  }, 1000);
}

function metOf(sm) {
  return {
    steps: sm.st >= sm.stg,
    workout: sm.wo >= sm.wog,
    sleep: sm.sl != null && sm.sl >= sm.slg,
    food: sm.fd > 0,
  };
}
const metCount = (sm) => Object.values(metOf(sm)).filter(Boolean).length;

function statusFor(sm) {
  if (!sm) return { text: "Not logged yet", cls: "badge--quiet" };
  const n = metCount(sm);
  if (n === 4) return { text: "Crushing it", cls: "badge--great" };
  if (n === 3) return { text: "On track", cls: "badge--good" };
  if (n === 2) return { text: "Getting there", cls: "badge--warm" };
  return { text: "Needs a nudge", cls: "badge--quiet" };
}

// Activity rate: progress toward steps, workout and sleep goals, plus food logged.
// Each part counts for a quarter and is capped at 100%.
function activityRate(sm) {
  if (!sm) return 0;
  const part = (v, goal) => (goal > 0 ? Math.min(1, (v || 0) / goal) : 0);
  const parts = [part(sm.st, sm.stg), part(sm.wo, sm.wog), sm.sl == null ? 0 : part(sm.sl, sm.slg), sm.fd > 0 ? 1 : 0];
  return Math.round((parts.reduce((a, b) => a + b, 0) / 4) * 100);
}

// Average activity over the last 7 days (days with nothing logged count as 0)
function weeklyRate(m) {
  let total = 0;
  for (let i = 0; i < 7; i++) total += activityRate(m.days?.[shiftDate(todayISO(), -i)]);
  return Math.round(total / 7);
}

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

function rateRing(pct, label) {
  const r = 22, c = 2 * Math.PI * r;
  const wrap = document.createElement("div");
  wrap.className = "rate";
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", `Activity ${label}: ${pct}%`);
  wrap.innerHTML = `<svg viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r="${r}" class="rate__track"/>
      ${pct > 0 ? `<circle cx="28" cy="28" r="${r}" class="rate__fill" stroke-dasharray="${(c * pct) / 100} ${c}" transform="rotate(-90 28 28)"/>` : ""}
    </svg>`;
  const txt = document.createElement("span");
  txt.className = "rate__text";
  const num = document.createElement("strong");
  num.textContent = `${pct}%`;
  const sub = document.createElement("small");
  sub.textContent = label;
  txt.append(num, sub);
  wrap.append(txt);
  return wrap;
}

function weekCount(m) {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const sm = m.days?.[shiftDate(todayISO(), -i)];
    if (sm && metCount(sm) >= 3) n++;
  }
  return n;
}

function openGroupView(code) {
  closeGroupView();
  openGroup = code;
  groupInfo = (profile?.groups || []).find((g) => g.code === code) || null;
  groupMembers = [];
  groupLoaded = false;
  el.groupMsg.textContent = "";
  unwatchGroup.push(store.watchGroup(code, (g, meta) => {
    if (g) groupInfo = { ...g, removed: groupInfo?.removed };
    else if (!meta?.fromCache) groupInfo = { gone: true, name: groupInfo?.name };
    render();
  }, () => {}));
  unwatchGroup.push(store.watchGroupMembers(code, (list) => {
    groupMembers = list;
    groupLoaded = true;
    render();
  }, () => {
    // Not allowed to read members: they were removed from the group
    groupLoaded = true;
    groupInfo = { ...(groupInfo || {}), removed: true };
    render();
  }));
  render();
  window.scrollTo(0, 0);
}

function closeGroupView() {
  unwatchGroup.forEach((u) => u && u());
  unwatchGroup = [];
  openGroup = null;
  el.groupLeaveConfirm.hidden = true;
  removeArmed = null;
}

function renderGroups() {
  if (el.groupsPanel.hidden) return;
  const groups = profile?.groups || [];
  el.groupsListView.hidden = !!openGroup;
  el.groupDetail.hidden = !openGroup;
  el.linkPanel.hidden = el.linkPanel.hidden || !!openGroup; // focus on the group while it's open

  if (!openGroup) {
    el.groupList.replaceChildren();
    for (const g of groups) {
      const li = document.createElement("li");
      li.className = "link-row";
      const name = document.createElement("span");
      name.className = "link-row__name";
      name.textContent = g.name || "Group";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "btn btn--small";
      open.textContent = "Open";
      open.addEventListener("click", () => openGroupView(g.code));
      li.append(name, open);
      el.groupList.append(li);
    }
    return;
  }

  const isOwner = groupInfo?.owner && groupInfo.owner === store.uid;
  el.groupTitle.textContent = groupInfo?.name || "Group";
  el.groupInvite.textContent = openGroup;
  const ended = groupInfo?.gone || groupInfo?.removed;
  el.groupNote.hidden = !ended;
  if (groupInfo?.gone) el.groupNote.textContent = "This group was deleted by its creator. You can remove it from your list.";
  else if (groupInfo?.removed) el.groupNote.textContent = "You're no longer a member of this group. You can remove it from your list.";
  el.groupLeave.textContent = ended ? "Remove from my list" : isOwner ? "Delete group" : "Leave group";
  el.groupInvite.closest(".group-invite").hidden = !!ended;
  el.groupLeave.hidden = !el.groupLeaveConfirm.hidden;
  el.groupCount.textContent = groupLoaded ? `${groupMembers.length} member${groupMembers.length === 1 ? "" : "s"}` : "Loading…";

  const today = todayISO();
  const sorted = [...groupMembers].sort((a, b) =>
    weeklyRate(b) - weeklyRate(a) ||
    activityRate(b.days?.[today]) - activityRate(a.days?.[today]) ||
    (a.name || "").localeCompare(b.name || ""));
  // Equal weekly rates share a rank
  const ranks = [];
  sorted.forEach((m, i) => { ranks[i] = i > 0 && weeklyRate(m) === weeklyRate(sorted[i - 1]) ? ranks[i - 1] : i + 1; });

  // Most points in the group earns the Top points badge (ties share it)
  const topPoints = Math.max(0, ...groupMembers.map((m) => m.points || 0));
  const meTop = groupMembers.length >= 2 && topPoints > 0 &&
    (groupMembers.find((m) => m.id === store.uid)?.points || 0) === topPoints;
  if (meTop && !profile?.badges?.champion) awardBadges(["champion"]);

  el.groupMembers.replaceChildren();
  sorted.forEach((m, i) => {
    const sm = m.days?.[today] || null;
    const me = m.id === store.uid;
    const li = document.createElement("li");
    li.className = "member";

    const head = document.createElement("div");
    head.className = "member__head";
    const rankBox = document.createElement("div");
    rankBox.className = "member__rank" + (ranks[i] === 1 && weeklyRate(m) > 0 ? " is-first" : "");
    rankBox.textContent = `#${ranks[i]}`;
    const who = document.createElement("div");
    who.className = "member__who";
    const name = document.createElement("span");
    name.className = "member__name";
    name.textContent = (m.name || "Member") + (me ? " (you)" : "");
    const place = document.createElement("span");
    place.className = "member__place";
    place.textContent = `${ordinal(ranks[i])} of ${sorted.length} overall · ${fmt(m.points || 0)} points` +
      (m.level ? ` · Level ${m.level}` : "") + (m.id === groupInfo?.owner ? " · group creator" : "");
    const st = statusFor(sm);
    const badge = document.createElement("span");
    badge.className = "badge " + st.cls;
    badge.textContent = st.text;
    const tags = document.createElement("div");
    tags.className = "member__badges";
    if (topPoints > 0 && (m.points || 0) === topPoints) {
      const top = document.createElement("span");
      top.className = "badge badge--top";
      top.textContent = "★ Top points";
      tags.append(top);
    }
    tags.append(badge);
    who.append(name, place, tags);
    head.append(rankBox, who, rateRing(activityRate(sm), "today"));

    const stats = document.createElement("dl");
    stats.className = "member__stats";
    const met = sm ? metOf(sm) : {};
    const stat = (label, value, sub, ok) => {
      const w = document.createElement("div");
      w.className = "mstat" + (ok ? " is-met" : "");
      const dt = document.createElement("dt"); dt.textContent = label;
      const dd = document.createElement("dd"); dd.textContent = value;
      if (sub) { const sml = document.createElement("small"); sml.textContent = sub; dd.append(sml); }
      w.append(dt, dd);
      stats.append(w);
    };
    stat("Steps", sm ? fmt(sm.st) : "—", sm ? `of ${fmt(sm.stg)}` : "", met.steps);
    stat("Workout", sm ? `${fmt(sm.wo)} min` : "—", sm ? `of ${sm.wog} min` : "", met.workout);
    stat("Food", sm ? (sm.fd ? `${sm.fd} logged` : "None yet") : "—", sm && sm.kc ? `${fmt(sm.kc)} kcal` : "", met.food);
    stat("Sleep", sm && sm.sl != null ? formatHours(sm.sl) : "—", sm ? `of ${sm.slg} h` : "", met.sleep);

    const week = document.createElement("div");
    week.className = "member__week";
    const dots = document.createElement("span");
    dots.className = "dots";
    dots.setAttribute("aria-hidden", "true");
    for (let k = 6; k >= 0; k--) {
      const d = shiftDate(today, -k);
      const dsm = m.days?.[d];
      const dot = document.createElement("span");
      dot.className = "dot" + (dsm && metCount(dsm) >= 3 ? " is-on" : "") + (k === 0 ? " is-today" : "");
      dot.title = dayTitle(d);
      dots.append(dot);
    }
    const wtext = document.createElement("span");
    wtext.textContent = `Weekly activity ${weeklyRate(m)}% · on track ${weekCount(m)} of 7 days`;
    week.append(dots, wtext);

    li.append(head, stats, week);

    if (isOwner && !me) {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "food-row__delete member__remove";
      rm.textContent = removeArmed === m.id ? `Tap again to remove ${m.name || "this member"}` : "Remove from group";
      rm.addEventListener("click", async () => {
        if (removeArmed !== m.id) { removeArmed = m.id; render(); return; }
        removeArmed = null;
        try { await store.removeMember(openGroup, m.id); el.groupMsg.textContent = `${m.name || "Member"} was removed.`; }
        catch { el.groupMsg.textContent = "Couldn't remove them. Try again."; }
      });
      li.append(rm);
    }
    el.groupMembers.append(li);
  });
}

async function addGroupToList(code, name) {
  const groups = [...(profile?.groups || []).filter((g) => g.code !== code), { code, name }];
  profile = { ...(profile || {}), groups };
  await store.saveGroups(groups);
  updateProgress(null, { quiet: true });
}

async function removeGroupFromList(code) {
  const groups = (profile?.groups || []).filter((g) => g.code !== code);
  profile = { ...(profile || {}), groups };
  await store.saveGroups(groups);
}

el.groupCreateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = el.groupName.value.trim();
  if (!name) { el.groupsMsg.textContent = "Give your group a name, like Fit Family."; el.groupName.focus(); return; }
  if ((profile?.groups || []).length >= 10) { el.groupsMsg.textContent = "You can be in up to 10 groups. Leave one to create another."; return; }
  el.groupsMsg.textContent = "Creating your group…";
  const code = newShareCode();
  try {
    await store.createGroup(code, name);
    await store.saveMember(code, memberData());
    await addGroupToList(code, name);
    el.groupName.value = "";
    el.groupsMsg.textContent = "";
    openGroupView(code);
    el.groupMsg.textContent = "Group created. Copy the invite code below and share it with your people.";
  } catch {
    el.groupsMsg.textContent = "Couldn't create the group. Check your connection and try again.";
  }
});

el.groupJoinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = normalizeCode(el.groupCode.value);
  if (!code) { el.groupsMsg.textContent = "Group codes have 12 letters and numbers, like K7QF-9XMA-2PDW."; return; }
  if ((profile?.groups || []).some((g) => g.code === code)) { openGroupView(code); return; }
  el.groupsMsg.textContent = "Looking up that group…";
  try {
    const info = await store.getGroup(code);
    if (!info) { el.groupsMsg.textContent = "No group found for that code. Check it with the person who invited you."; return; }
    await store.saveMember(code, memberData());
    await addGroupToList(code, info.name || "Group");
    el.groupCode.value = "";
    el.groupsMsg.textContent = "";
    openGroupView(code);
    el.groupMsg.textContent = `You joined ${info.name || "the group"}. Your steps, workouts, sleep and food totals are now shared with its members.`;
  } catch {
    el.groupsMsg.textContent = "Couldn't join right now. Check your connection and try again.";
  }
});

el.groupBack.addEventListener("click", () => { closeGroupView(); render(); });

el.groupCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(openGroup);
    el.groupMsg.textContent = "Invite code copied.";
  } catch {
    const range = document.createRange();
    range.selectNodeContents(el.groupInvite);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    el.groupMsg.textContent = "Code selected. Use Copy from your device's menu.";
  }
});

el.groupLeave.addEventListener("click", () => {
  const isOwner = groupInfo?.owner === store.uid;
  if (groupInfo?.gone || groupInfo?.removed) { leaveCurrentGroup(); return; }
  el.groupLeaveText.textContent = isOwner
    ? "Delete this group for everyone? All members will lose access to its insights."
    : "Leave this group? Its members will no longer see your insights.";
  el.groupLeaveYes.textContent = isOwner ? "Delete group" : "Leave group";
  el.groupLeaveConfirm.hidden = false;
  render();
});
el.groupLeaveNo.addEventListener("click", () => { el.groupLeaveConfirm.hidden = true; render(); });
el.groupLeaveYes.addEventListener("click", leaveCurrentGroup);

async function leaveCurrentGroup() {
  const code = openGroup;
  const isOwner = groupInfo?.owner === store.uid;
  const gone = groupInfo?.gone || groupInfo?.removed;
  el.groupLeaveYes.disabled = true;
  try {
    if (!gone) {
      if (isOwner) await store.deleteGroup(code);
      else await store.leaveGroup(code);
    }
    await removeGroupFromList(code);
    closeGroupView();
    el.groupsMsg.textContent = gone ? "Removed from your list." : isOwner ? "Group deleted." : "You left the group.";
  } catch {
    el.groupMsg.textContent = "Couldn't do that right now. Check your connection and try again.";
  } finally {
    el.groupLeaveYes.disabled = false;
    render();
  }
}

// ---------- Cycle updates (for people someone shares their cycle tracker with) ----------
async function setCycleUpdates(code, on) {
  const person = links.find((l) => l.code === code);
  const n = person?.name || "them";
  let device = null;
  let note = "";
  if (on) {
    if (pushState === "ok") {
      try {
        device = await deviceToken();
      } catch (err) {
        on = false;
        note = err?.code === "denied"
          ? (isIOSDevice()
            ? "Notifications are off for Health Log. Turn them on in Settings, Notifications, Health Log, then try again from the Reminders page."
            : "Notifications are blocked for this site. Allow them in your browser's site settings, then try again from the Reminders page.")
          : "Couldn't turn on notifications on this device. Try again from the Reminders page.";
      }
    } else {
      note = pushState === "needs-install"
        ? `Cycle updates for ${n} are on. To receive them, open Health Log from your Home Screen, go to Reminders and switch them on there once.`
        : `Cycle updates for ${n} are on, but this browser can't show notifications.`;
    }
  }
  links = links.map((l) => (l.code === code ? { ...l, cycleUpdates: on, cycleAsked: true } : l));
  render();
  try {
    await store.saveLinks(links, device);
    if (!note) note = on ? `You'll get a notification when ${n}'s cycle phase changes.` : `Cycle updates for ${n} are off.`;
  } catch {
    note = "Couldn't save that. Check your connection and try again.";
  }
  return note;
}

el.watchYes.addEventListener("click", async () => {
  if (!viewing) return;
  el.watchMsg.textContent = await setCycleUpdates(viewing, true);
  render();
});
el.watchNo.addEventListener("click", async () => {
  if (!viewing) return;
  el.watchMsg.textContent = await setCycleUpdates(viewing, false);
  el.watchMsg.textContent += " You can turn them on any time on the Reminders page.";
  render();
});

function renderCycleUpdates() {
  const list = links.filter((l) => l.cycleAsked || l.cycleUpdates);
  el.remCycle.hidden = !list.length;
  el.remCycleList.replaceChildren();
  for (const l of list) {
    const li = document.createElement("li");
    const row = document.createElement("label");
    row.className = "switch-row switch-row--list";
    const name = document.createElement("span");
    name.textContent = l.name || "Linked person";
    const sw = document.createElement("input");
    sw.type = "checkbox";
    sw.className = "switch";
    sw.setAttribute("role", "switch");
    sw.checked = !!l.cycleUpdates;
    sw.setAttribute("aria-label", `Cycle updates for ${l.name || "this person"}`);
    sw.addEventListener("change", async () => {
      el.remMsg.textContent = await setCycleUpdates(l.code, sw.checked);
      render();
    });
    row.append(name, sw);
    li.append(row);
    el.remCycleList.append(li);
  }
}

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
    for (const g of profile?.groups || []) {
      const info = await store.getGroup(g.code).catch(() => null);
      if (info?.owner === store.uid) await store.deleteGroup(g.code).catch(() => {});
      else await store.leaveGroup(g.code).catch(() => {});
    }
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
let installWanted = false;   // the tip applies to this device; shown on the Today page

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
    installWanted = true;
  } else if (isAndroid) {
    el.installText.textContent = inApp
      ? "Open this page in Chrome first, then use the menu (⋮) and tap Install app or Add to Home screen."
      : "Open the browser menu (⋮) and tap Install app or Add to Home screen.";
    installWanted = true;
  }
  render();
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  let dismissed = false;
  try { dismissed = localStorage.getItem(INSTALL_KEY) === "1"; } catch {}
  if (dismissed) return;
  el.installText.textContent = "Open it like an app, straight from your home screen.";
  el.installBtn.hidden = false;
  installWanted = true;
  render();
});

el.installBtn.addEventListener("click", async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => {});
  installEvent = null;
  installWanted = false;
  render();
});

el.installClose.addEventListener("click", () => {
  installWanted = false;
  render();
  try { localStorage.setItem(INSTALL_KEY, "1"); } catch {}
});

window.addEventListener("appinstalled", () => { installWanted = false; render(); });

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
  fbApp = app;
  // Keep people signed in on this device (also inside home-screen web apps)
  auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
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
    if (!user.emailVerified) {
      // They may have verified in another browser (e.g. Safari) since this copy last checked
      try { await reload(user); } catch {}
      if (!user.emailVerified) { showVerify(user); return; }
    }
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
    loadRecent();
    checkPush().then((state) => { pushState = state; render(); });
  };
})();
