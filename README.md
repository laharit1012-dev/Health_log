# Health Log

A private daily health log for family and friends.

**Open the app:** https://laharit1012-dev.github.io/Health_log/

Everyone signs up with their own email and password and sees only their own log.

Each day you can log:
- **Steps**: progress toward 10,000
- **Water**: glasses (250 ml each), goal 8
- **Sleep**: bedtime and wake-up time; hours are worked out automatically
- **Workouts**: as many as you did (walk, strength, yoga…), each with minutes and notes, plus a daily total
- **Food**: everything eaten through the day, grouped by meal, with optional calories
- **Period** (shown only for women): log the day each period starts to see your cycle day, average cycle length and when the next one is expected. This is private unless you choose to share it: when a woman creates her share code, she's asked whether people with the code may also see her period tracker, and she can change that answer any time.

**Goals:** tap **Edit goals** to set your own daily targets for steps, water, sleep and workout minutes (starter goals are 10,000 steps, 8 glasses, 8 hours, 30 minutes). Reached goals get a tick, a small celebration, and a **step streak** counts the days in a row you reached your step goal. A short tip suggests the goal you're closest to finishing.

Use the arrows at the top to look back at earlier days. **Edit profile** changes your name and gender. Gender is asked when you create an account.

## Install it like an app

Open the link, then:
- **iPhone/iPad (Safari):** tap **Share** → **Add to Home Screen**.
- **Android (Chrome):** tap **Install** in the app's tip, or menu (⋮) → **Install app**.

It then has its own **Health Log** icon and opens full screen. Shared links show a preview card with the icon in WhatsApp, Facebook, LinkedIn and iMessage.

## Account and privacy

- New accounts confirm their email address with a link before they can use the app.
- **Account → Delete my account** permanently deletes the account, all logs, period data and any shared copy (asks for the password first).
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
