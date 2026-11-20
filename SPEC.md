# Secret Santa — concept spec

A chaotic, meme-energy Secret Santa website for a Discord friend group.
Hosted free on **GitHub Pages**, with a free **Firebase (Firestore)** database behind it.

## Core decisions

| Area | Decision |
|---|---|
| Hosting | Static site on GitHub Pages (you push the repo, enable Pages) |
| Data | Firebase Firestore, free Spark plan, called straight from the browser |
| Login | Display name + secret 4–6 digit PIN, works on any device |
| Organizer | Hands-off: nobody runs the draw by hand, and nobody can read the pairings, not even the site owner |
| Dates | Set on the page when the event is created (sign-up close/draw date, reveal date), so it can be reused next year |
| Budget | **$20 max.** Go over and you get roasted like a turkey |
| Vibe | Chaotic meme energy: loud colors, goofy copy, confetti, air horns |

## Event lifecycle

1. **Create event.** Name, draw date, reveal date. Produces a shareable link plus a join code to post in Discord.
2. **Sign-up phase.** Friends join with name + PIN and fill in their profile:
   - **Gift preference:** shipping address for a physical gift, *or* virtual gift preferred (with a Steam/Epic code, email or handle).
   - **Draw rules:** each person marks anyone they shouldn't draw (partner, roommate). Rules apply both ways.
3. **Auto-draw.** The first visit after the draw date runs the draw in that visitor's browser: a random derangement (nobody draws themselves) that respects every exclusion. If no valid draw exists, the page says so loudly.
4. **Santa phase.** Each Santa logs in and sees their giftee plus the giftee's address or virtual details.
   - **Anonymous Santa chat:** the giftee and their Santa can message each other, and the Santa shows up only as "🎅 Your Santa".
5. **Reveal day.** A **dramatic one-by-one reveal** built to screen-share in a Discord call: click to reveal each Santa, with a drumroll, confetti and an air horn.
6. **Turkey Court.** After the reveal, giftees can anonymously flag a gift as "suspiciously over budget." Flagged Santas get a roast on the public **Wall of Shame** 🦃🔥.

## Privacy approach

- Each participant's browser creates an encryption keypair at sign-up. The private key is stored encrypted with a key derived from their PIN, so logging in on another device still works.
- At draw time, each pairing gets its own secret "mailbox" key, encrypted separately for the Santa and for the giftee.
  - Each Santa's assignment is readable only by that Santa.
  - Addresses are encrypted into the mailbox, so only the matching Santa can read them.
  - Chat messages go through the same mailbox, so the Santa stays anonymous.
- The pairing list stays encrypted until reveal day. This is "trust among friends" level: someone tech-savvy with devtools at the moment the draw runs could peek, and a site owner could change the code later. That's fine for this group.
- The Firebase config in the public repo is normal. Access is controlled by Firestore security rules.

## Defaults I'll assume unless told otherwise

- Turkey Court roasts come from a large pool of **pre-written roast lines** (no AI API key exposed). You can add your own lines.
- One active event at a time, with a "start a new event" button for next year.
- Max group size about 50 (plenty for a Discord group).

## Setup you'll do once

1. Create a free Firebase project → enable Firestore → paste the config into `config.js`. I'll write exact click-by-click steps.
2. Paste the provided `firestore.rules` into the Firebase console.
3. Push the folder to a GitHub repo → Settings → Pages → deploy from `main`.
4. Post the link + join code in Discord.
