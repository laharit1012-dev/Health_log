# Health Log

A private daily health log for family and friends.

**Open the app:** https://laharit1012-dev.github.io/Health_log/

Everyone signs up with their own email and password and sees only their own log.

The app has these pages, switched with the tab bar at the bottom:
- **Today:** your day summary, goals and the daily log.
- **Cycle** (women only, or when viewing someone who shared theirs): cycle day, expected next period, and logged start dates.
- **Family:** share codes and linked family members.
- **Reminders:** water and workout reminders.
- **Account:** sign out, privacy policy and Delete my account.

Each day you can log:
- **Steps**: progress toward 10,000
- **Water**: glasses (250 ml each), goal 8
- **Sleep**: bedtime and wake-up time; hours are worked out automatically
- **Workouts**: as many as you did (walk, strength, yoga…), each with minutes and notes, plus a daily total
- **Food**: everything eaten through the day, grouped by meal, with optional calories
- **Cycle** (shown only for women): log the day each period starts to see your cycle day, average cycle length and when the next one is expected. This is private unless you choose to share it: when a woman creates her share code, she's asked whether people with the code may also see her cycle tracker, and she can change that answer any time.

**Goals:** tap **Edit goals** to set your own daily targets for steps, water, sleep and workout minutes (starter goals are 10,000 steps, 8 glasses, 8 hours, 30 minutes). Reached goals get a tick, a small celebration, and a **step streak** counts the days in a row you reached your step goal. A short tip suggests the goal you're closest to finishing.

Use the arrows at the top to look back at earlier days. **Edit profile** changes your name and gender. Gender is asked when you create an account.

## Reminders

In **Reminders**, each person can turn on:
- **Drink water:** every 1–3 hours between the times they choose.
- **Workout:** once a day at a chosen time.

A reminder is skipped once that goal is already reached for the day. On iPhone and iPad, reminders work when Health Log is opened from the Home Screen (Add to Home Screen, with Open as Web App on).

How it works: `.github/workflows/reminders.yml` runs `reminders/send-reminders.mjs` every 15 minutes (GitHub may start it a few minutes late). It reads the reminder settings of people who turned reminders on, works out what's due in each person's time zone, and sends notifications with Firebase Cloud Messaging. `firebase-messaging-sw.js` shows them on the device. Scheduling rules live in `reminders/schedule.mjs` (tests: `cd reminders && npm test`).

Setup (once):
1. Firebase console → Project settings → **Cloud Messaging** → Web Push certificates → **Generate key pair**. Put the key in `vapidKey` in `firebase-config.js`.
2. Firebase console → Project settings → **Service accounts** → **Generate new private key**. In GitHub → Settings → Secrets and variables → Actions, add it as a secret named `FIREBASE_SERVICE_ACCOUNT` (paste the whole file's contents). Never commit this file.

## Groups

On the **Family** page, under **Groups**:
- **Create a group** (for example "Fit Family") and share its invite code, or **Join a group** with a code. You can be in up to 10 groups.
- The group page ranks members by today's progress, with a status (**Crushing it**, **On track**, **Getting there**, **Needs a nudge**), today's steps, workout minutes, sleep and food (items logged and calories), and a 7-day strip of days on track (3 or more of the 4 goals met).
- Shared with the group: steps, workout minutes, sleep hours, number of food items and calories, and goals, for the last 7 days. Never what was eaten, notes, or the cycle tracker.
- The creator can remove members or delete the group; anyone can leave.

## Install it like an app

Open the link, then:
- **iPhone/iPad (Safari):** tap **Share** → **Add to Home Screen**.
- **Android (Chrome):** tap **Install** in the app's tip, or menu (⋮) → **Install app**.

It then has its own **Health Log** icon and opens full screen. Shared links show a preview card with the icon in WhatsApp, Facebook, LinkedIn and iMessage.

## Account and privacy

- New accounts confirm their email address with a link before they can use the app.
- **Account page → Delete my account** permanently deletes the account, all logs, period data and any shared copy (asks for the password first).
- See the [privacy policy](privacy.html).

## Seeing each other's logs (share codes)

Under **Link with family**:
- **Create share code** gives you a code like `K7QF-9XMA-2PDW`. Anyone you give it to can *view* your log, never change it.
- **See someone's log**: enter the code someone gave you. Their name appears as a button at the top so you can switch between logs.
- To see each other's logs, both people create a code and enter the other's.
- **Turn off sharing** stops the code working right away. Sharing again gives a new code.

## Light and dark mode

The switch in the header flips between light and dark, and the choice is remembered on that device. Until you pick one, the app follows your device's setting. All colors are variables at the top of `styles.css`; the dark palette is derived from the light one and every text/background pair meets WCAG AA contrast (4.5:1).

## How it's built

- Plain HTML, CSS and JavaScript, hosted on GitHub Pages. No build step.
- **Firebase Authentication** for email/password sign-in and password resets.
- **Cloud Firestore** for storage. `firestore.rules` locks each person's log to them; shared copies can be opened only with their code, and only the owner can change them.
- `firebase-config.js` holds the Firebase project settings. These are meant to be public; access is controlled by the rules.

## Files

- `index.html`: page structure
- `styles.css`: light/dark palettes and styling
- `app.js`: sign-in, logging, saving and share codes
- `firebase-config.js`: Firebase project settings
- `firestore.rules`: database security rules (paste into Firebase console → Firestore → Rules)
- `privacy.html`: privacy policy
- `manifest.webmanifest`, `icons/`: app icon, home-screen install and link preview image

## Releasing an update

Bump the version number in `index.html` (the `?v=` on `styles.css` and `app.js`, and the footer) and in the `firebase-config.js?v=` import at the top of `app.js`. Browsers then load the new files instead of an older saved copy, and the footer shows which version each device is running.
