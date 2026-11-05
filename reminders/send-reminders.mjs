// Runs every 15 minutes from GitHub Actions (.github/workflows/reminders.yml).
// Reads who has reminders on, works out what's due in each person's time zone,
// skips reminders for goals already reached today, and sends them with
// Firebase Cloud Messaging.
import admin from "firebase-admin";
import { localNow, waterSlotDue, workoutDue, workoutMinutes, DEFAULT_GOALS } from "./schedule.mjs";

const APP_URL = "https://laharit1012-dev.github.io/Health_log/";
const ICON = APP_URL + "icons/icon-192.png";

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.log("FIREBASE_SERVICE_ACCOUNT secret isn't set yet. Nothing to send.");
  process.exit(0);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const now = new Date();
const GONE = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"]);

async function sendTo(tokens, title, body) {
  const dead = [];
  let sent = 0;
  for (const t of tokens) {
    try {
      await admin.messaging().send({
        token: t.token,
        webpush: {
          notification: { title, body, icon: ICON, badge: ICON },
          fcmOptions: { link: APP_URL },
        },
      });
      sent++;
    } catch (err) {
      if (GONE.has(err?.code)) dead.push(t.token);
      else console.warn("Send failed:", err?.code || err?.message);
    }
  }
  return { sent, dead };
}

const users = await db.collection("users").where("remindersOn", "==", true).get();
let total = 0;

for (const snap of users.docs) {
  const u = snap.data();
  const tokens = Array.isArray(u.pushTokens) ? u.pushTokens.filter((t) => t?.token) : [];
  if (!tokens.length) continue;

  const r = u.reminders || {};
  const goals = { ...DEFAULT_GOALS, ...(u.goals || {}) };
  const state = u.reminderState || {};
  const local = localNow(now, r.tz || "UTC");
  const waterKey = waterSlotDue(r.water, local, state.waterSlot);
  const workoutKey = workoutDue(r.workout, local, state.workoutDate);
  if (!waterKey && !workoutKey) continue;

  const day = (await db.doc(`users/${snap.id}/days/${local.date}`).get()).data() || {};
  const update = {};
  let dead = [];

  if (waterKey) {
    update["reminderState.waterSlot"] = waterKey;
    const glasses = Number(day.water) || 0;
    if (glasses < goals.water) {
      const res = await sendTo(tokens, "Time for some water",
        glasses ? `You're at ${glasses} of ${goals.water} glasses today. One more?` : `Start your ${goals.water} glasses for today with one now.`);
      total += res.sent; dead = dead.concat(res.dead);
    }
  }

  if (workoutKey) {
    update["reminderState.workoutDate"] = workoutKey;
    const mins = workoutMinutes(day);
    if (mins < goals.workout) {
      const left = goals.workout - mins;
      const res = await sendTo(tokens, "Time to move",
        mins ? `${left} more minutes to reach today's ${goals.workout}-minute goal. You've got this!`
             : `A ${goals.workout}-minute workout today keeps your streak strong. Let's go!`);
      total += res.sent; dead = dead.concat(res.dead);
    }
  }

  if (dead.length) update.pushTokens = tokens.filter((t) => !dead.includes(t.token));
  await snap.ref.update(update);
}

console.log(`Checked ${users.size} people with reminders on. Sent ${total} notifications.`);
