# Health Log

A private daily health log for family and friends.

**Open the app:** https://laharit1012-dev.github.io/Health_log/

Everyone signs up with their own email and password and sees only their own log.

The app has these pages, switched with the tab bar at the bottom:
- **Today:** your day summary, goals and the daily log.
- **Cycle** (women only, or when viewing someone who shared theirs): cycle day, expected next period, and logged start dates.
- **Family:** share codes and linked family members.
- **Reminders:** water and workout reminders.
- **Account** (the person button at the top): sign out, privacy policy and Delete my account.
- **Workouts:** weekly plans and workout videos.

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

## Points, levels and badges

- **Points:** up to 100 a day, 20 each for steps, water, sleep and workout (your share of each goal) and food (3 meals logged = 20).
- **Levels go up with consistency:** a day with 50+ points is a consistent day; 5 consistent days in a week (Monday to Sunday) moves you up one level. Levels never go down. Names: Starter, Walker, Mover, Hiker, Runner, Climber, Athlete, Champion, Hero, Legend.
- **Daily title** from today's points: 1+ Warming up, 50+ Go-getter, 75+ Achiever, 100 Superstar. Shown on Today and on each member's box in groups.
- **Badges (13):** First step, 10K club, Perfect day, On a roll (3-day step streak), Week warrior (7), Unstoppable (30), Hydration hero, Workout warrior, Well rested, Marathon week, Team player, Runner rank (Level 5), Group champion (most points in a group of 2 or more).
- The Today page shows your total points, level, points to the next level, today's activity ring, and your badge shelf.

## Cycle phases and cycle updates

The Cycle page shows the current phase (Period, Follicular, Ovulation, Luteal) with a short note on how energy and mood often feel. Phases are estimated from logged period start dates and cycle length (period about 5 days, ovulation about 14 days before the next period).

When someone views a person who shares their cycle tracker, they're asked once: **Get cycle updates?** If yes, the reminders job sends them a notification when that person's phase changes (between 9 AM and 9 PM their time). They can switch updates on or off any time under **Reminders → Cycle updates**.

## Challenges

The **Challenges** page (open it from the challenge card on Today) lists the challenges in `challenges.js`. Days count automatically from what people log.

- 🎄 **Christmas Challenge** (Nov 5 – Dec 25): 50+ points on 35 days.
- 🧃 **Post-Holiday Reset** (Dec 26 – 31): step and water goals every day.
- 🎆 **New Year Challenge** (Jan): step and workout goals on 25 days.
- ❄️ **Winter Arc** (Nov 1 – Feb 28): 50+ points on 90 days.
- 🔥 **75-Day Challenge** (start any day): 30+ min workout plus water and step goals, 75 days in a row; missing a day means restarting.

Finishing a challenge earns its own badge. Each group on the Family page shows a leaderboard for the challenges its members joined. To add next month's challenge, add an entry to `challenges.js` and release an update.

## Workouts

The **Workouts** tab has weekly plans and a **video library of about 200 YouTube workouts in 10 folders**: Full body, Upper body, Lower body (each with bodyweight and dumbbell videos, mostly 20–30 min), Core, Cardio, Walking, Yoga, Pilates, Stretching and Period yoga. Videos are listed in `workouts.js`.

- **My equipment:** *Bodyweight only* (default) or *I have dumbbells*. Today's workout follows this choice.
- **Today's workout** comes from your plan and moves through the whole folder day by day, so it doesn't repeat for weeks.
- Open a folder to browse it, filter by Bodyweight/Dumbbells, play a video inline, and **Log it** to add it to Today (earning points).

- **Women:** **Cycle Sync** (shown first) picks today's workout from her cycle phase. Period: gentle yoga, walks and stretching. Follicular: strength, upper and lower body, cardio. Ovulation: cardio, strength, lower body. Luteal: Pilates, core, walks, yoga. Without a logged period it suggests a walk and asks her to log one on the Cycle page. Strong at Home, Walk More, Yoga & Flexibility and Cardio Boost are also offered.
- **Men:** Upper / Lower Split, Full Body Strength and Core & Cardio (shown first), plus Walk More, Yoga & Flexibility and Cardio Boost.
- **Prefer not to say:** every plan except Cycle Sync.

Phase advice is general guidance from how energy often changes through the cycle, not medical advice.

## Steps from Apple Health (iPhone)

An iPhone Shortcut can fill in today's steps: it reads steps from Apple Health and opens `https://laharit1012-dev.github.io/Health_log/?steps=<number>`. The app saves that number as today's steps once you're signed in (step-by-step setup is in the app under Steps → *Fill in steps from Apple Health*). Android doesn't have an equivalent built in, so steps are typed there.

## Groups

On the **Family** page, under **Groups**:
- **Create a group** (for example "Fit Family") and share its invite code, or **Join a group** with a code. You can be in up to 10 groups.
- Each member has a box with their **overall rank** in the group, name, **activity rate** for today, and today's steps, workout, food (items logged and calories) and sleep, plus a 7-day strip.
- **Activity rate:** progress toward the steps, workout and sleep goals, plus whether food was logged. Each part counts for a quarter and is capped at 100%.
- **Overall rank:** by average activity rate over the last 7 days (days with nothing logged count as 0); ties share a rank.
- Shared with the group: steps, workout minutes, sleep hours, number of food items and calories, and goals, for the last 7 days. Never what was eaten, notes, or the cycle tracker.
- Whoever has the most points in the group gets a **★ Top points** badge on their box (ties share it).
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

Bump the version number in all of these, to the same number:
- `version.json`
- `APP_VERSION` at the top of `app.js`
- `index.html`: the `?v=` on `styles.css` and `app.js`, and the footer
- the `?v=` on the imports at the top of `app.js`

Phones then load the new files instead of an older saved copy. When the app opens or comes back on screen, it compares itself with `version.json` and shows **A new version of Health Log is ready · Update now** if it's behind. **Account → Refresh app** always reloads the newest version.

## Paid access and the Shop (version 37)

- People pay for one challenge. An admin then opens **Account → 🛠️ Admin**, finds them by email and gives them that challenge. The app opens for the challenge's dates and locks again afterwards, leaving only the Shop and Account.
- **All access** (no end date) is for family and friends: everything is open and every challenge can be joined for free.
- Prices and payment links are in `shop.js`. Put a Razorpay or Stripe payment link in `payLink` and the Shop shows a **Pay & join** button.
- Admins are marked by a document `admins/<their user ID>`, created by hand in the Firebase console.
- Database: `access/<uid>` (written only by admins), `directory/<uid>` (email and name, so admins can search). The rules in `firestore.rules` only allow saving a day's log while someone has access.
