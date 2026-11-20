# 🎅 Secret Santa (chaotic edition) 🦃

A Secret Santa site for the Discord crew. Static files on GitHub Pages + a free Firebase (Firestore) database.

**$20 max. Go over and you get dragged to Turkey Court.**

## How it works

1. Someone opens the site and **starts an event** (name, draw date, reveal date) → gets a link to drop in Discord.
2. Friends **join** with a name + 6-digit PIN and say where their gift goes (📦 shipping address or 💻 virtual).
   They can tick people they shouldn't draw (partner, roommate). Works both ways.
3. At the draw time, the first person to open the page **automatically runs the draw**. No admin, nobody sees the list.
4. Everyone **unwraps their giftee**, sees their address/handle, and can **chat anonymously** with their giftee and with their own Santa.
5. On reveal day: **▶ START THE SHOW**, a one-by-one reveal with drumroll, air horn and confetti, built for screen-sharing in a Discord call.
6. **Turkey Court**: giftees can charge their Santa with overspending → public roast on the Wall of Shame.

## Privacy (honest version)

- Firestore security rules make sure you can only read **your own** assignment, a Santa can only read **their giftee's** address, chat boxes are only readable by the two people in them, and the full who-had-whom list only unlocks at the reveal time (server clock).
- The browser that happens to run the draw has the pairings in memory for a moment. Someone poking at devtools at that exact moment could peek.
- The Firebase project owner can see everything in the Firebase console. **Promise not to look.** 🤞

## Files

| File | What |
|---|---|
| `index.html`, `styles.css` | the page |
| `js/app.js` | everything: sign-up, draw, chat, reveal, Turkey Court |
| `js/draw.js` | the matching algorithm (no self-draws, respects exclusions, avoids A↔B pairs) |
| `js/roasts.js` | Turkey Court roast lines. **Add your own!** |
| `js/fx.js` | confetti + synthesized drumroll / air horn |
| `js/config.js` | Firebase web config (public by design) |
| `firestore.rules` | database security rules. Paste into Firebase console → Firestore → Rules |

## Firebase setup (one time)

1. https://console.firebase.google.com → **Add project** (Analytics off). Free Spark plan, no card.
2. **Build → Firestore Database → Create database** → production mode.
3. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable** (just the first toggle).
4. **Firestore → Rules** → paste `firestore.rules` → Publish.
5. **Project settings → Your apps → Web (</>)** → register → copy the config into `js/config.js`.

Never upgrade to the Blaze plan for this; nothing here needs it.

## Running locally

Any static server works, e.g. `python -m http.server 8000`, then open http://localhost:8000.
