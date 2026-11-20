# 🎅 Secret Santa (chaotic edition) 🦃

A Secret Santa site for the Discord crew. Static files on GitHub Pages + a free Firebase (Firestore) database.

**$20 max. Go over and you get dragged to Turkey Court.**

## How it works

1. Someone opens the site and **starts an event** (name, draw date, reveal date) → gets a link to drop in Discord.
2. Friends open the link and get a step-by-step welcome: tap the **Secret Santa** logo → pick a name + 6-digit PIN →
   choose 📦 shipping address or 💻 virtual → "You're in!" with the draw date and a countdown telling them when to come back.
   After joining, their page is just a big countdown to the draw (plus a small "where your gift goes" check/edit).
3. At the draw time, the first person to open the page **automatically runs the draw**. No admin, nobody sees the list.
   The draw keeps 📦 address people with address people and 💻 virtual people with virtual people. It only crosses
   types when it has to (a type with just 1–2 people, or "don't draw" exclusions in the way), using as few
   cross-overs as possible, and it avoids A↔B pairs so nobody can work out who their Santa is.
4. Everyone **unwraps their giftee** and sees their address/handle, with a big reminder not to go over $20.
5. On reveal day: **▶ START THE SHOW**, a one-by-one reveal with a name-spinner and confetti, built for screen-sharing in a Discord call.
6. **Turkey Court**: giftees can charge their Santa with overspending → public roast on the Wall of Shame.

## Organizer mode 🛠

Whoever starts an event sets an **organizer password**. Log in with it from the "🛠 Organizer? Log in here" link at the bottom of the event page. (It's a separate login, so the organizer can also JOIN as a normal player.)

- **Before the draw:** see who joined (and 📦/💻), set **🚫 don't match** pairs (partners, roommates; works both ways), **Remove** duplicates/fakes (that account can't rejoin), edit the name and dates, or **🎰 Draw names NOW**.
- **After the draw:** **Remove & patch** someone who drops out (their Santa takes over their giftee), **🔁 Redraw** everyone, or **🔓 Peek** at one person's giftee if they forgot their PIN, so you can DM it to them.
- The organizer never sees the matches unless they click Peek.

## Privacy (honest version)

- Firestore security rules make sure you can only read **your own** assignment, a Santa can only read **their giftee's** address, and the full who-had-whom list only unlocks at the reveal time (server clock).
- The browser that happens to run the draw has the pairings in memory for a moment. Someone poking at devtools at that exact moment could peek.
- The Firebase project owner can see everything in the Firebase console. **Promise not to look.** 🤞

## Files

| File | What |
|---|---|
| `index.html`, `styles.css` | the page |
| `js/app.js` | everything: sign-up, draw, reveal, Turkey Court, organizer mode |
| `js/draw.js` | the matching algorithm (no self-draws, respects exclusions, keeps gift types together, avoids A↔B pairs) |
| `js/roasts.js` | Turkey Court roast lines. **Add your own!** |
| `js/fx.js` | confetti |
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
