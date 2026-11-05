# Health Log

A private daily health log for family and friends. Everyone signs up with their own email and password and sees only their own log.

Each day you can log:
- **Steps**: progress toward 10,000
- **Water**: glasses (250 ml each), goal 8
- **Sleep**: bedtime and wake-up time; hours are worked out automatically
- **Workout**: type, minutes and notes
- **Food**: everything eaten through the day, grouped by meal, with optional calories

Use the arrows at the top to look back at earlier days. **Edit name** changes the name shown on your log.

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
