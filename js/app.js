import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, collection, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, Timestamp, runTransaction,
  writeBatch, deleteField, arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig, BUDGET, MIN_PLAYERS, MAX_PLAYERS } from "./config.js";
import { makeDraw, shuffle } from "./draw.js";
import { roastFor } from "./roasts.js";
import { confetti } from "./fx.js";

// ======================================================================
// Setup
// ======================================================================
const app = document.getElementById("app");

if (firebaseConfig.apiKey === "REPLACE_ME") {
  app.innerHTML = "";
  app.append(h("div", { class: "card yellow" },
    h("h2", {}, "🔧 Almost there"),
    h("p", {}, "Paste your Firebase web config into js/config.js and reload. See README.md."),
  ));
  throw new Error("Firebase config missing");
}

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

const params = new URLSearchParams(location.search);
const eventId = params.get("e");

const S = {
  event: null,
  user: undefined,          // undefined = auth not resolved yet
  participants: [],
  me: null,                 // my participant doc (or null)
  myPrivate: null,
  assignment: undefined,    // undefined = not loaded, null = none
  gifteePrivate: null,
  reveal: null,
  flags: [],
  phase: null,
  drawing: false,
  drawError: null,
  isAdmin: false,
};

const unsubs = { event: null, participants: null, user: [] };
let currentView = null;

// ======================================================================
// Helpers
// ======================================================================
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v; // only ever used with static strings
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 3200);
}

const nameKey = (n) => n.trim().toLowerCase().replace(/\s+/g, " ");

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Each person gets a hidden Firebase account derived from event + name + PIN.
async function credsFor(name, pin) {
  const hash = await sha256hex(eventId + "|" + nameKey(name));
  return { email: `u${hash.slice(0, 40)}@example.com`, password: `santa|${eventId}|${pin}` };
}

// The organizer gets a separate hidden account per event, unlocked by the organizer password.
async function adminCredsFor(eid, pw) {
  const hash = await sha256hex(eid + "|__organizer__");
  return { email: `a${hash.slice(0, 40)}@example.com`, password: `admin|${eid}|${pw}` };
}

const pad2 = (n) => String(n).padStart(2, "0");
const toLocalInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const sameMinute = (a, b) => Math.floor(a.getTime() / 60000) === Math.floor(b.getTime() / 60000);
const eventRef = () => doc(db, "events", eventId);

// A button that needs a second click to confirm (no browser pop-ups).
function confirmBtn(label, confirmLabel, cls, action) {
  const b = h("button", { class: `btn small ${cls}`, type: "button" }, label);
  let armed = false;
  let t;
  b.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      b.textContent = confirmLabel;
      t = setTimeout(() => { armed = false; b.textContent = label; }, 4000);
      return;
    }
    clearTimeout(t);
    b.disabled = true;
    try {
      await action();
    } catch (e) {
      console.error(e);
      toast("Failed: " + (e.message || e));
    }
    if (b.isConnected) { b.disabled = false; armed = false; b.textContent = label; }
  });
  return b;
}

function randId(len = 24) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return [...buf].map((x) => chars[x % chars.length]).join("");
}

const toDate = (ts) => (ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null);

function fmtDate(d) {
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function nameOf(uid) {
  return S.participants.find((p) => p.id === uid)?.name || "Mystery Elf";
}

function storedName() {
  try { return localStorage.getItem("ss:name:" + eventId) || ""; } catch { return ""; }
}
function storeName(n) {
  try { localStorage.setItem("ss:name:" + eventId, n); } catch {}
}
function seen(key) {
  try { return localStorage.getItem("ss:seen:" + eventId + ":" + key) === "1"; } catch { return false; }
}
function markSeen(key) {
  try { localStorage.setItem("ss:seen:" + eventId + ":" + key, "1"); } catch {}
}

function countdownEl(target) {
  const el = h("div", { class: "countdown", "data-target": String(target.getTime()) });
  updateCountdown(el);
  return el;
}
function updateCountdown(el) {
  let ms = Math.max(0, Number(el.dataset.target) - Date.now());
  const d = Math.floor(ms / 86400000); ms -= d * 86400000;
  const hh = Math.floor(ms / 3600000); ms -= hh * 3600000;
  const m = Math.floor(ms / 60000); ms -= m * 60000;
  const s = Math.floor(ms / 1000);
  el.replaceChildren(
    ...[[d, "DAYS"], [hh, "HRS"], [m, "MIN"], [s, "SEC"]].map(([v, l]) =>
      h("div", {}, h("b", {}, String(v).padStart(2, "0")), h("small", {}, l))),
  );
}

function computePhase() {
  const ev = S.event;
  if (!ev) return null;
  const now = Date.now();
  const drawAt = toDate(ev.drawAt)?.getTime() ?? now;
  const revealAt = toDate(ev.revealAt)?.getTime() ?? Infinity;
  if (ev.status === "open") return now >= drawAt ? "drawing" : "open";
  return now >= revealAt ? "revealed" : "drawn";
}

function friendlyAuthError(err) {
  const code = err?.code || "";
  if (code.includes("email-already-in-use")) return "That name is already taken in this event. If it's you, use LOG IN.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return "Wrong name or PIN. Try again, you absolute snowman.";
  if (code.includes("too-many-requests")) return "Too many tries. The elves locked the door. Wait a bit.";
  if (code.includes("network")) return "Network hiccup. Check your connection.";
  if (code.includes("operation-not-allowed")) return "Login isn't switched on in Firebase yet (Email/Password provider).";
  if (code.includes("permission-denied")) return "Not allowed. Sign-ups may be closed, or the organizer removed this account.";
  return err?.message || "Something broke. Blame the elves.";
}

// ======================================================================
// Landing: create an event
// ======================================================================
function renderLanding() {
  app.replaceChildren();
  const local = toLocalInput;
  const now = new Date();
  const year = now.getMonth() === 11 && now.getDate() > 20 ? now.getFullYear() + 1 : now.getFullYear();
  let draw = new Date(year, 11, 1, 20, 0);
  if (draw <= now) draw = new Date(now.getTime() + 3 * 86400000);
  const reveal = new Date(year, 11, 23, 20, 0) > draw ? new Date(year, 11, 23, 20, 0) : new Date(draw.getTime() + 14 * 86400000);

  const err = h("p", { class: "error" });
  const form = h("form", { class: "stack" },
    h("label", {}, "Event name",
      h("input", { name: "name", required: true, maxlength: 60, placeholder: "The Group Chat Gift Heist 2026" })),
    h("label", {}, "🎲 Sign-ups close & names get drawn",
      h("input", { name: "drawAt", type: "datetime-local", required: true, value: local(draw) })),
    h("label", {}, "🥁 Big reveal (who had whom)",
      h("input", { name: "revealAt", type: "datetime-local", required: true, value: local(reveal) })),
    h("p", { class: "muted" }, `Budget is locked at $${BUDGET}. Go over and Turkey Court will deal with you.`),
    h("label", {}, "🛠 Organizer password (8+ characters)",
      h("input", { name: "adminPw", type: "password", minlength: 8, maxlength: 64, required: true, autocomplete: "new-password" })),
    h("label", {}, "Organizer password again",
      h("input", { name: "adminPw2", type: "password", minlength: 8, maxlength: 64, required: true, autocomplete: "new-password" })),
    h("p", { class: "muted" }, "Lets you fix problems later: remove duplicate accounts, change dates, redraw. You still can't see who has whom unless you deliberately peek. Save it somewhere: there's no reset."),
    err,
    h("button", { class: "btn pink huge", type: "submit" }, "🎄 START THE CHAOS"),
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    const fd = new FormData(form);
    const name = String(fd.get("name")).trim();
    const drawAt = new Date(String(fd.get("drawAt")));
    const revealAt = new Date(String(fd.get("revealAt")));
    if (!name) return (err.textContent = "Give it a name, coward.");
    if (!(drawAt > new Date(Date.now() + 60000))) return (err.textContent = "The draw has to be in the future.");
    if (!(revealAt > drawAt)) return (err.textContent = "The reveal has to come after the draw. Time travel is $21, over budget.");
    const adminPw = String(fd.get("adminPw"));
    if (adminPw.length < 8) return (err.textContent = "Organizer password needs 8+ characters.");
    if (adminPw !== String(fd.get("adminPw2"))) return (err.textContent = "Organizer passwords don't match.");
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const ref = doc(collection(db, "events"));
      const { email, password } = await adminCredsFor(ref.id, adminPw);
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(ref, {
        adminUid: cred.user.uid,
        name,
        drawAt: Timestamp.fromDate(drawAt),
        revealAt: Timestamp.fromDate(revealAt),
        budget: BUDGET,
        status: "open",
        createdAt: serverTimestamp(),
      });
      try { localStorage.setItem("ss:created:" + ref.id, "1"); } catch {}
      location.href = `?e=${ref.id}`;
    } catch (ex) {
      console.error(ex);
      err.textContent = "Couldn't create the event: " + friendlyAuthError(ex);
      btn.disabled = false;
    }
  });

  app.append(
    h("section", { class: "card tilt-l" },
      h("span", { class: "big-emoji" }, "🎁🎄🦃"),
      h("h1", {}, "SECRET SANTA FOR THE GROUP CHAT"),
      h("p", {}, "Everyone signs up with a name and a PIN. On draw day the site secretly matches everyone up. You see who you're buying for and where to send it. On reveal day we find out who had whom, in the most dramatic way possible."),
      h("p", {}, h("b", {}, `$${BUDGET} max.`), " Go over and you get dragged to Turkey Court."),
    ),
    h("section", { class: "card yellow tilt-r" }, h("h2", {}, "Start a new Secret Santa"), form),
  );
}

// ======================================================================
// Event page
// ======================================================================
function startEvent() {
  unsubs.event = onSnapshot(doc(db, "events", eventId), { includeMetadataChanges: true }, (snap) => {
    if (!snap.exists()) {
      app.replaceChildren(h("div", { class: "card pink" },
        h("h2", {}, "🕳️ No event here"),
        h("p", {}, "This link is broken or the event never existed."),
        h("a", { class: "btn yellow", href: "./" }, "Start a new one")));
      return;
    }
    // "estimate" fills in pending server timestamps (e.g. right after "Draw names NOW")
    S.event = { id: snap.id, ...snap.data({ serverTimestamps: "estimate" }) };
    S.eventPending = snap.metadata.hasPendingWrites;
    document.title = `${S.event.name} · Secret Santa`;
    render();
  }, (e) => {
    console.error(e);
    app.replaceChildren(h("div", { class: "card pink" }, h("h2", {}, "Couldn't load the event"), h("p", {}, e.message)));
  });

  unsubs.participants = onSnapshot(
    query(collection(db, "events", eventId, "participants"), orderBy("joinedAt")),
    (snap) => {
      S.participants = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      S.me = S.user ? S.participants.find((p) => p.id === S.user.uid) || null : null;
      updatePeople();
      render();
    },
    (e) => console.error("participants", e),
  );

  onAuthStateChanged(auth, async (user) => {
    for (const u of unsubs.user) u();
    unsubs.user = [];
    S.myPrivate = null;
    S.assignment = undefined;
    S.gifteePrivate = null;
    S.reveal = null;
    S.flags = [];

    // An account from a different event (or a stale login) doesn't count here.
    let admin = false;
    if (user) {
      admin = user.email === (await adminCredsFor(eventId, "x")).email;
      if (!admin) {
        const n = storedName();
        const expected = n ? (await credsFor(n, "0")).email : null;
        if (!expected || user.email !== expected) {
          await signOut(auth);
          return;
        }
      }
    }
    S.user = user || null;
    S.isAdmin = admin;
    S.me = user && !admin ? S.participants.find((p) => p.id === user.uid) || null : null;
    if (user && !admin) subscribeUserData();
    if (admin) S.assignment = null;
    currentView = null;
    render();
  });

  // Clock: countdowns + phase changes.
  setInterval(() => {
    document.querySelectorAll(".countdown").forEach(updateCountdown);
    const p = computePhase();
    if (p !== S.phase) render();
  }, 1000);
}

function subscribeUserData() {
  const uid = S.user.uid;
  unsubs.user.push(onSnapshot(doc(db, "events", eventId, "private", uid),
    (s) => { S.myPrivate = s.exists() ? s.data() : null; updateMyDelivery(); },
    (e) => console.warn("private", e.code)));
  subscribeAssignment();
}

function subscribeAssignment() {
  if (S._asgSub) return;
  const uid = S.user.uid;
  const off = onSnapshot(doc(db, "events", eventId, "assignments", uid), (s) => {
    S.assignment = s.exists() ? s.data() : null;
    // The organizer may patch or redraw: follow the (possibly new) giftee.
    if (S._gifteeSub && S._gifteeSubFor !== S.assignment?.gifteeUid) {
      S._gifteeSub();
      S._gifteeSub = null;
      S.gifteePrivate = null;
    }
    if (S.assignment && !S._gifteeSub) {
      S._gifteeSubFor = S.assignment.gifteeUid;
      S._gifteeSub = onSnapshot(doc(db, "events", eventId, "private", S.assignment.gifteeUid),
        (gs) => { S.gifteePrivate = gs.exists() ? gs.data() : null; updateGifteeDelivery(); },
        (e) => console.warn("giftee private", e.code));
      unsubs.user.push(() => { S._gifteeSub?.(); S._gifteeSub = null; });
    }
    render();
  }, (e) => { console.warn("assignment", e.code); S.assignment = null; render(); });
  S._asgSub = off;
  unsubs.user.push(() => { off(); S._asgSub = null; });
}

// Re-render only when the "shape" of the page changes, so typing isn't interrupted.
function render() {
  if (!S.event || S.user === undefined) return;
  S.phase = computePhase();
  // Wait until the server has confirmed the event (e.g. a just-changed draw time) before drawing.
  if (S.phase === "drawing" && (S.me || S.isAdmin) && !S.drawing && !S.drawError && !S.eventPending) runDraw();
  const a = S.assignment;
  const ev = S.event;
  const key = [S.phase, S.user?.uid || "anon", S.isAdmin ? "admin" : S.me ? "member" : "guest",
    a === undefined ? "?" : a ? `asg:${a.gifteeUid}:${a.santaBox}:${a.myBox}` : "noasg",
    S.drawError || "", S.drawing ? "drawing" : "",
    ev.name, toDate(ev.drawAt)?.getTime(), toDate(ev.revealAt)?.getTime(), ev.status].join("|");
  if (key === currentView) return;
  currentView = key;

  app.replaceChildren(headerCard());
  if (S.isAdmin) {
    app.append(...adminView());
    return;
  }
  if (!S.user || !S.me) {
    app.append(...guestView());
    return;
  }
  if (S.phase === "open") app.append(...openView());
  else if (S.phase === "drawing") app.append(...drawingView());
  else {
    app.append(...santaView());
    const hero = app.querySelector(".giftee-hero");
    if (hero && S.phase === "drawn") app.prepend(hero);
  }
}

function headerCard() {
  const ev = S.event;
  const drawAt = toDate(ev.drawAt);
  const revealAt = toDate(ev.revealAt);
  const phaseLabel = {
    open: ["🎲 NAMES DRAWN IN", drawAt],
    drawing: ["🎰 THE ELVES ARE DRAWING NAMES…", null],
    drawn: ["🥁 BIG REVEAL IN", revealAt],
    revealed: ["🎉 REVEALED. TURKEY COURT IS OPEN.", null],
  }[S.phase];
  return h("section", { class: "card blue tilt-l" },
    h("h1", {}, ev.name),
    h("p", {}, `Draw: ${fmtDate(drawAt)} · Reveal: ${fmtDate(revealAt)} · `, h("span", { class: "badge" }, `$${ev.budget || BUDGET} MAX`)),
    h("h3", {}, phaseLabel[0]),
    phaseLabel[1] ? countdownEl(phaseLabel[1]) : null,
    S.user && (S.me || S.isAdmin) ? h("p", { class: "muted", style: "margin-top:12px" },
      "Logged in as ", h("b", {}, S.isAdmin ? "🛠 the organizer" : S.me.name), " · ",
      h("button", { class: "link-btn", onclick: logout }, "log out")) : null,
  );
}

function peopleList() {
  return h("ul", { class: "people", id: "people" });
}
function updatePeople() {
  const ul = document.getElementById("people");
  if (ul && !S.participants.length) {
    ul.replaceChildren(h("li", { class: "muted" }, "Nobody yet. Be the first victim."));
  } else if (ul) {
    ul.replaceChildren(...S.participants.map((p) =>
      h("li", { class: "person" + (S.user && p.id === S.user.uid ? " me" : "") }, p.name)));
  }
  const c = document.getElementById("peopleCount");
  if (c) c.textContent = String(S.participants.length);
  updateExclusions();
  updateAdminPeople();
}

function shareCard() {
  const url = location.origin + location.pathname + "?e=" + eventId;
  const input = h("input", { value: url, readonly: true, onfocus: (e) => e.target.select() });
  return h("section", { class: "card lime tilt-r" },
    h("h2", {}, "📣 Drop this in the Discord"),
    h("div", { class: "share" }, input,
      h("button", {
        class: "btn pink", type: "button",
        onclick: async () => {
          try { await navigator.clipboard.writeText(url); toast("Copied! Go spam the group chat."); }
          catch { input.select(); toast("Select + copy it manually."); }
        },
      }, "COPY")),
  );
}

// ---------------------------------------------------------------------
// Guest (not logged in)
// ---------------------------------------------------------------------
function guestView() {
  const open = S.phase === "open";
  const out = [];
  const created = (() => { try { return localStorage.getItem("ss:created:" + eventId) === "1"; } catch { return false; } })();
  if (created && open) out.push(shareCard());

  const people = h("section", { class: "card" },
    h("h2", {}, "WHO'S IN (", h("span", { id: "peopleCount" }, String(S.participants.length)), ")"),
    peopleList());

  let mode = open ? "join" : "login";
  const body = h("div");
  const tabs = h("div", { class: "tabs" });
  const drawTabs = () => {
    tabs.replaceChildren(
      open ? h("button", { class: "tab" + (mode === "join" ? " active" : ""), type: "button", onclick: () => { mode = "join"; drawTabs(); } }, "JOIN") : null,
      h("button", { class: "tab" + (mode === "login" ? " active" : ""), type: "button", onclick: () => { mode = "login"; drawTabs(); } }, "LOG IN"),
    );
    body.replaceChildren(mode === "join" ? joinForm() : loginForm());
  };
  drawTabs();

  out.push(h("section", { class: "card pink tilt-r" },
    !open ? h("p", {}, S.phase === "drawing" ? "Sign-ups are closed. Log in to see who you got." : "Sign-ups are closed. Log in to see your giftee.") : null,
    tabs, body));
  out.push(people);
  out.push(adminLoginCard());
  queueMicrotask(updatePeople);
  return out;
}

function adminLoginCard() {
  const err = h("p", { class: "error" });
  const pw = h("input", { type: "password", required: true, minlength: 8, autocomplete: "current-password", placeholder: "Organizer password" });
  const form = h("form", { class: "stack", hidden: true }, pw, err,
    h("button", { class: "btn ghost", type: "submit" }, "🔓 Open the organizer panel"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    try {
      const { email, password } = await adminCredsFor(eventId, pw.value);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (ex) {
      err.textContent = ex?.code?.includes("invalid-credential") ? "Wrong organizer password." : friendlyAuthError(ex);
    }
  });
  return h("section", { class: "card" },
    h("button", { class: "link-btn", type: "button", onclick: () => { form.hidden = !form.hidden; if (!form.hidden) pw.focus(); } }, "🛠 Organizer? Log in here"),
    form);
}

// ---------------------------------------------------------------------
// Organizer (admin) panel
// ---------------------------------------------------------------------
function adminView() {
  const out = [];
  const drawn = S.event.status === "drawn";
  out.push(h("section", { class: "card yellow tilt-r" },
    h("h2", {}, "🛠 ORGANIZER MODE"),
    h("p", {}, "Fix problems here: duplicate accounts, people dropping out, date changes. You can't see who has whom unless you click 🔓 Peek on someone."),
    h("p", { class: "muted" }, "Want to play too? Log out, then JOIN with your own name + PIN like everyone else. Come back here any time with the 🛠 link at the bottom of the page."),
  ));
  if (S.phase === "open") out.push(shareCard());
  if (S.phase === "drawing") out.push(...drawingView());
  out.push(adminSettingsCard());
  out.push(h("section", { class: "card" },
    h("h2", {}, "👥 PLAYERS (", h("span", { id: "peopleCount" }, String(S.participants.length)), ")"),
    h("p", { class: "muted" }, drawn
      ? "Remove & patch: drops someone after the draw. Their Santa takes over their giftee, so nobody ends up giftless."
      : "Remove: kicks a duplicate or fake account. That account can't rejoin (the person can rejoin under a new name)."),
    h("div", { class: "admin-list", id: "adminPeople" })));
  if (drawn) out.push(adminRedrawCard());
  out.push(h("section", { class: "card" },
    h("h3", {}, "🆘 Someone forgot their PIN?"),
    h("p", {}, "PINs can't be reset. ", drawn
      ? "Click 🔓 Peek next to their name and DM them their giftee + address. They'll still get their own gift."
      : "Remove their old account, then have them JOIN again with a slightly different name (like \"Bob 2\")."),
  ));
  queueMicrotask(updateAdminPeople);
  return out;
}

function adminSettingsCard() {
  const ev = S.event;
  const open = ev.status === "open";
  const err = h("p", { class: "error" });
  const name = h("input", { maxlength: 60, required: true });
  name.value = ev.name;
  const drawAt = h("input", { type: "datetime-local", required: true, disabled: !open });
  drawAt.value = toLocalInput(toDate(ev.drawAt));
  const revealAt = h("input", { type: "datetime-local", required: true });
  revealAt.value = toLocalInput(toDate(ev.revealAt));
  const form = h("form", { class: "stack" },
    h("label", {}, "Event name", name),
    h("label", {}, open ? "🎲 Draw date" : "🎲 Draw date (already happened)", drawAt),
    h("label", {}, "🥁 Reveal date", revealAt),
    err,
    h("div", { class: "row" },
      h("button", { class: "btn pink", type: "submit" }, "Save changes"),
      open ? confirmBtn("🎰 Draw names NOW", "Sure? Sign-ups close", "yellow", async () => {
        if (S.participants.length < MIN_PLAYERS) { toast(`Need at least ${MIN_PLAYERS} players first.`); return; }
        await updateDoc(eventRef(), { drawAt: serverTimestamp() });
        toast("Drawing names…");
      }) : null),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    const patch = {};
    const newName = name.value.trim();
    if (!newName) return (err.textContent = "Needs a name.");
    if (newName !== ev.name) patch.name = newName;
    const d = open ? new Date(drawAt.value) : toDate(ev.drawAt);
    const r = new Date(revealAt.value);
    if (open && !sameMinute(d, toDate(ev.drawAt))) {
      if (!(d > new Date())) return (err.textContent = "The draw date has to be in the future.");
      patch.drawAt = Timestamp.fromDate(d);
    }
    if (!sameMinute(r, toDate(ev.revealAt))) patch.revealAt = Timestamp.fromDate(r);
    if (!(r > d)) return (err.textContent = "The reveal has to come after the draw.");
    if (!Object.keys(patch).length) return toast("Nothing changed.");
    try {
      await updateDoc(eventRef(), patch);
      toast("Saved.");
    } catch (ex) {
      err.textContent = "Couldn't save: " + ex.message;
    }
  });
  return h("section", { class: "card lime" }, h("h2", {}, "⚙️ EVENT SETTINGS"), form);
}

function updateAdminPeople() {
  const box = document.getElementById("adminPeople");
  if (!box || !S.isAdmin) return;
  const drawn = S.event.status === "drawn";
  if (!S.participants.length) {
    box.replaceChildren(h("p", { class: "muted" }, "Nobody has joined yet."));
    return;
  }
  const ids = new Set(S.participants.map((p) => p.id));
  box.replaceChildren(...S.participants.map((p) => {
    const peekOut = h("div");
    const excl = (p.exclusions || []).filter((x) => ids.has(x)).map(nameOf);
    const joined = toDate(p.joinedAt);
    return h("div", { class: "admin-row" },
      h("div", { class: "admin-who" },
        h("b", {}, p.name),
        h("div", { class: "muted" }, joined ? "joined " + fmtDate(joined) : "just joined",
          excl.length ? ` · won't draw ${excl.join(", ")}` : ""),
        peekOut),
      h("div", { class: "row" },
        drawn ? confirmBtn("🔓 Peek", "Spoil it for you?", "ghost", () => peekGiftee(p, peekOut)) : null,
        confirmBtn(drawn ? "Remove & patch" : "Remove", "Click again to confirm", "pink",
          () => (drawn ? removeAfterDraw(p) : removeBeforeDraw(p)))));
  }));
}

async function removeBeforeDraw(p) {
  await deleteDoc(doc(db, "events", eventId, "private", p.id)).catch(() => {});
  await deleteDoc(doc(db, "events", eventId, "participants", p.id));
  await updateDoc(eventRef(), { banned: arrayUnion(p.id) });
  toast(`${p.name} removed.`);
}

async function removeAfterDraw(p) {
  const X = p.id;
  const pairsRef = doc(db, "events", eventId, "reveal", "pairs");
  const santaOf = (await getDoc(pairsRef)).data()?.santaOf || {};
  const santa = santaOf[X];
  const giftee = Object.keys(santaOf).find((g) => santaOf[g] === X);
  if (!santa || !giftee) {
    // Not in the draw at all: just remove them.
    await removeBeforeDraw(p);
    return;
  }
  if (santa === giftee || S.participants.length - 1 < MIN_PLAYERS) {
    toast("Can't patch this one (they and their Santa had each other, or too few people left). Remove them, then use REDRAW.");
    return;
  }
  const newBox = randId();
  const batch = writeBatch(db);
  batch.update(doc(db, "events", eventId, "assignments", santa), { gifteeUid: giftee, santaBox: newBox });
  batch.update(doc(db, "events", eventId, "assignments", giftee), { myBox: newBox });
  batch.delete(doc(db, "events", eventId, "assignments", X));
  batch.update(pairsRef, { [`santaOf.${giftee}`]: santa, [`santaOf.${X}`]: deleteField() });
  batch.delete(doc(db, "events", eventId, "private", X));
  batch.delete(doc(db, "events", eventId, "participants", X));
  batch.update(eventRef(), { banned: arrayUnion(X) });
  await batch.commit();
  toast(`${p.name} removed. Their Santa now has their giftee.`);
}

async function peekGiftee(p, out) {
  const a = await getDoc(doc(db, "events", eventId, "assignments", p.id));
  if (!a.exists()) {
    out.replaceChildren(h("p", { class: "muted" }, "Not in the draw."));
    return;
  }
  const g = a.data().gifteeUid;
  const info = await getDoc(doc(db, "events", eventId, "private", g)).then((s) => (s.exists() ? s.data() : null)).catch(() => null);
  out.replaceChildren(h("div", { class: "delivery", style: "margin-top:8px" },
    `${p.name} is buying for ${nameOf(g)}\n`,
    info ? `${info.deliveryType === "physical" ? "📦 " : "💻 "}${info.deliveryInfo}` : "(no delivery info yet)"));
}

function adminRedrawCard() {
  return h("section", { class: "card pink" },
    h("h2", {}, "🔁 REDRAW EVERYONE"),
    h("p", {}, "Nuclear option. Everyone gets a new giftee. Use it only if something is badly broken, then tell the group chat."),
    confirmBtn("🔁 Redraw", "REALLY redraw everyone?", "yellow", redraw));
}

async function redraw() {
  const ids = S.participants.map((p) => p.id);
  if (ids.length < MIN_PLAYERS) { toast(`Need at least ${MIN_PLAYERS} players.`); return; }
  const pairs = [];
  for (const p of S.participants) for (const x of p.exclusions || []) if (ids.includes(x)) pairs.push([p.id, x]);
  const assign = makeDraw(ids, pairs);
  if (!assign) { toast("No valid draw with these exclusions."); return; }
  const old = await getDocs(collection(db, "events", eventId, "assignments"));
  const boxOf = new Map(ids.map((id) => [id, randId()]));
  const batch = writeBatch(db);
  for (const d of old.docs) if (!assign.has(d.id)) batch.delete(d.ref);
  const santaOf = {};
  for (const [s, g] of assign) {
    batch.set(doc(db, "events", eventId, "assignments", s), { gifteeUid: g, santaBox: boxOf.get(g), myBox: boxOf.get(s) });
    santaOf[g] = s;
  }
  batch.set(doc(db, "events", eventId, "reveal", "pairs"), { santaOf });
  await batch.commit();
  try { for (const k of Object.keys(localStorage)) if (k.startsWith("ss:seen:" + eventId)) localStorage.removeItem(k); } catch {}
  toast("Redrawn! Tell everyone to check the site.");
}

function deliveryFields(current = {}) {
  const type = current.deliveryType || "physical";
  const info = h("textarea", { name: "deliveryInfo", maxlength: 500, required: true });
  info.value = current.deliveryInfo || "";
  const hint = h("p", { class: "muted" });
  const label = h("span");
  const setType = (t) => {
    if (t === "physical") {
      label.textContent = "📦 Shipping address (only your Santa can see this)";
      info.placeholder = "Name\nStreet\nCity, State ZIP\nCountry";
      hint.textContent = "Only the person who draws you can read this, and only after the draw.";
    } else {
      label.textContent = "💻 How should your Santa send it?";
      info.placeholder = "Steam friend code / Epic name / email for gift cards / Discord handle…";
      hint.textContent = "Steam friend code, Epic name, an email for e-gift cards, whatever works. Only your Santa sees it.";
    }
  };
  setType(type);
  const radios = h("div", { class: "choice-row" },
    h("label", { class: "choice" },
      h("input", { type: "radio", name: "deliveryType", value: "physical", checked: type === "physical", onchange: () => setType("physical") }),
      h("span", { class: "e" }, "📦"), "Ship me something"),
    h("label", { class: "choice" },
      h("input", { type: "radio", name: "deliveryType", value: "virtual", checked: type === "virtual", onchange: () => setType("virtual") }),
      h("span", { class: "e" }, "💻"), "Virtual gift please"),
  );
  return [radios, h("label", {}, label, info), hint];
}

function pinField(name, labelText) {
  return h("label", {}, labelText,
    h("input", { name, class: "pin-input", type: "password", inputmode: "numeric", pattern: "[0-9]{6}", minlength: 6, maxlength: 6, required: true, autocomplete: name === "pin" ? "current-password" : "new-password", placeholder: "••••••" }));
}

function joinForm() {
  const err = h("p", { class: "error" });
  const form = h("form", { class: "stack" },
    h("label", {}, "Your name (what your friends know you as)",
      h("input", { name: "name", required: true, maxlength: 30, autocomplete: "nickname", placeholder: "xX_GiftLord_Xx" })),
    pinField("pin", "Pick a 6-digit PIN"),
    pinField("pin2", "PIN again"),
    h("p", { class: "muted" }, "Remember it. You need your name + PIN to log back in. There's no reset."),
    ...deliveryFields(),
    err,
    h("button", { class: "btn yellow huge", type: "submit" }, "🎁 I'M IN"),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    const fd = new FormData(form);
    const name = String(fd.get("name")).trim().replace(/\s+/g, " ");
    const pin = String(fd.get("pin"));
    if (!/^\d{6}$/.test(pin)) return (err.textContent = "PIN must be exactly 6 digits.");
    if (pin !== String(fd.get("pin2"))) return (err.textContent = "PINs don't match. Focus.");
    if (S.participants.some((p) => p.nameKey === nameKey(name))) return (err.textContent = "Someone already has that name. If it's you, use LOG IN.");
    if (S.participants.length >= MAX_PLAYERS) return (err.textContent = "This event is full.");
    const deliveryType = String(fd.get("deliveryType"));
    const deliveryInfo = String(fd.get("deliveryInfo")).trim();
    if (!deliveryInfo) return (err.textContent = "Tell your Santa where to send it.");
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      storeName(name);
      const { email, password } = await credsFor(name, pin);
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await joinAs(cred.user.uid, name, { deliveryType, deliveryInfo });
      confetti(120);
      toast("You're in! 🎉");
    } catch (ex) {
      console.error(ex);
      err.textContent = friendlyAuthError(ex);
      btn.disabled = false;
    }
  });
  return form;
}

async function joinAs(uid, name, delivery) {
  await setDoc(doc(db, "events", eventId, "participants", uid), {
    name, nameKey: nameKey(name), exclusions: [], joinedAt: serverTimestamp(),
  });
  if (delivery) {
    await setDoc(doc(db, "events", eventId, "private", uid), { ...delivery, updatedAt: serverTimestamp() });
  }
}

function loginForm() {
  const err = h("p", { class: "error" });
  const nameInput = h("input", { name: "name", required: true, maxlength: 30, autocomplete: "nickname" });
  nameInput.value = storedName();
  const form = h("form", { class: "stack" },
    h("label", {}, "Your name", nameInput),
    pinField("pin", "Your 6-digit PIN"),
    err,
    h("button", { class: "btn yellow huge", type: "submit" }, "🔓 LET ME IN"),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    const fd = new FormData(form);
    const name = String(fd.get("name")).trim().replace(/\s+/g, " ");
    const pin = String(fd.get("pin"));
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      storeName(name);
      const { email, password } = await credsFor(name, pin);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      // Account exists but participant doc was removed (left the event): rejoin if still open.
      const p = await getDoc(doc(db, "events", eventId, "participants", cred.user.uid));
      if (!p.exists() && S.phase === "open") await joinAs(cred.user.uid, name, null);
    } catch (ex) {
      console.error(ex);
      err.textContent = friendlyAuthError(ex);
      btn.disabled = false;
    }
  });
  return form;
}

async function logout() {
  await signOut(auth);
  toast("Logged out. Santa has forgotten you (temporarily).");
}

// ---------------------------------------------------------------------
// Open phase (member, before the draw)
// ---------------------------------------------------------------------
function openView() {
  const out = [shareCard()];

  out.push(h("section", { class: "card" },
    h("h2", {}, "WHO'S IN (", h("span", { id: "peopleCount" }, String(S.participants.length)), ")"),
    peopleList(),
    S.participants.length < MIN_PLAYERS
      ? h("p", { class: "muted", style: "margin-top:12px" }, `Need at least ${MIN_PLAYERS} people before the draw. Recruit harder.`)
      : null,
  ));

  out.push(exclusionsCard());
  out.push(myDeliveryCard());

  out.push(h("section", { class: "card" },
    h("h3", {}, "Changed your mind?"),
    h("button", {
      class: "btn ghost small", type: "button",
      onclick: async () => {
        if (!confirm("Leave this Secret Santa? You can rejoin later with the same name + PIN while sign-ups are open.")) return;
        try {
          await deleteDoc(doc(db, "events", eventId, "private", S.user.uid)).catch(() => {});
          await deleteDoc(doc(db, "events", eventId, "participants", S.user.uid));
          await signOut(auth);
          toast("You left. Coward. 🐔");
        } catch (e) { toast("Couldn't leave: " + e.message); }
      },
    }, "Leave event"),
  ));
  queueMicrotask(() => { updatePeople(); updateExclusions(); updateMyDelivery(); });
  return out;
}

function exclusionsCard() {
  return h("section", { class: "card yellow tilt-r" },
    h("h2", {}, "🚫 Who should you NOT draw?"),
    h("p", {}, "Partner? Roommate? Sibling who already knows what you want? Tick them and you won't draw each other (works both ways)."),
    h("div", { class: "checks", id: "exclusions" }),
  );
}
function updateExclusions() {
  const box = document.getElementById("exclusions");
  if (!box || !S.me) return;
  const others = S.participants.filter((p) => p.id !== S.me.id);
  if (!others.length) {
    box.replaceChildren(h("p", { class: "muted" }, "Nobody else has joined yet."));
    return;
  }
  const mine = new Set(S.me.exclusions || []);
  const theirs = new Set(S.participants.filter((p) => (p.exclusions || []).includes(S.me.id)).map((p) => p.id));
  box.replaceChildren(...others.map((p) => {
    const cb = h("input", { type: "checkbox", checked: mine.has(p.id) });
    cb.addEventListener("change", async () => {
      const next = new Set(S.me.exclusions || []);
      cb.checked ? next.add(p.id) : next.delete(p.id);
      try {
        await updateDoc(doc(db, "events", eventId, "participants", S.me.id), { exclusions: [...next] });
        toast(cb.checked ? `You won't draw ${p.name} (and vice versa).` : `${p.name} is back in the pool.`);
      } catch (e) { toast("Couldn't save: " + e.message); cb.checked = !cb.checked; }
    });
    return h("label", { class: "check" }, cb, p.name, theirs.has(p.id) && !mine.has(p.id) ? h("span", { title: "They excluded you" }, " 🔒") : null);
  }));
}
function myDeliveryCard() {
  return h("section", { class: "card", id: "myDeliveryCard" },
    h("h2", {}, "🎯 Where your gift goes"),
    h("div", { id: "myDelivery" }));
}
function updateMyDelivery() {
  const box = document.getElementById("myDelivery");
  if (!box) return;
  const p = S.myPrivate;
  const view = () => box.replaceChildren(
    p ? h("p", {}, p.deliveryType === "physical" ? "📦 Shipping to:" : "💻 Virtual gift via:") : h("p", { class: "error" }, "You haven't said where to send your gift yet!"),
    p ? h("div", { class: "delivery" }, p.deliveryInfo) : null,
    S.phase === "open" ? h("button", { class: "btn small yellow", type: "button", style: "margin-top:12px", onclick: edit }, p ? "Edit" : "Add it") : null,
  );
  const edit = () => {
    const err = h("p", { class: "error" });
    const form = h("form", { class: "stack" }, ...deliveryFields(p || {}), err,
      h("div", { class: "row" },
        h("button", { class: "btn pink", type: "submit" }, "Save"),
        p ? h("button", { class: "btn ghost", type: "button", onclick: view }, "Cancel") : null));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const info = String(fd.get("deliveryInfo")).trim();
      if (!info) return (err.textContent = "Can't be empty.");
      try {
        await setDoc(doc(db, "events", eventId, "private", S.user.uid), {
          deliveryType: String(fd.get("deliveryType")), deliveryInfo: info, updatedAt: serverTimestamp(),
        });
        toast("Saved.");
      } catch (ex) { err.textContent = ex.message; }
    });
    box.replaceChildren(form);
  };
  view();
}

// ---------------------------------------------------------------------
// The draw (runs in the first member's browser after the draw time)
// ---------------------------------------------------------------------
async function runDraw() {
  S.drawing = true;
  try {
    const snap = await getDocs(collection(db, "events", eventId, "participants"));
    const people = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (people.length < MIN_PLAYERS) {
      S.drawError = "notenough";
      return;
    }
    const ids = people.map((p) => p.id);
    const pairs = [];
    for (const p of people) for (const x of p.exclusions || []) if (ids.includes(x)) pairs.push([p.id, x]);
    const assign = makeDraw(ids, pairs);
    if (!assign) {
      S.drawError = "impossible";
      return;
    }
    // Box ids stay in assignments for compatibility (the chat feature was removed).
    const boxOf = new Map(ids.map((id) => [id, randId()]));
    const eventRef = doc(db, "events", eventId);
    await runTransaction(db, async (tx) => {
      const ev = await tx.get(eventRef);
      if (ev.data().status !== "open") return;
      for (const [santa, giftee] of assign) {
        tx.set(doc(db, "events", eventId, "assignments", santa), {
          gifteeUid: giftee,
          santaBox: boxOf.get(giftee),
          myBox: boxOf.get(santa),
        });
      }
      const santaOf = {};
      for (const [s, g] of assign) santaOf[g] = s;
      tx.set(doc(db, "events", eventId, "reveal", "pairs"), { santaOf });
      tx.update(eventRef, { status: "drawn", drawnAt: serverTimestamp(), count: ids.length });
    });
  } catch (e) {
    console.error("draw failed", e);
    // Most likely the server clock says it's not time yet, or someone else drew first. Retry soon.
    setTimeout(() => { S.drawing = false; currentView = null; render(); }, 8000);
    return;
  } finally {
    if (S.drawError) { S.drawing = false; currentView = null; render(); }
  }
  S.drawing = false;
}

function drawingView() {
  if (S.drawError === "notenough") {
    return [h("section", { class: "card yellow" },
      h("h2", {}, "😬 Not enough elves"),
      h("p", {}, `Only ${S.participants.length} ${S.participants.length === 1 ? "person" : "people"} joined. Need at least ${MIN_PLAYERS}. Sign-ups are closed, so start a new event with a later date.`),
      h("a", { class: "btn pink", href: "./" }, "New event"))];
  }
  if (S.drawError === "impossible") {
    return [h("section", { class: "card yellow" },
      h("h2", {}, "🤯 The rules are impossible"),
      h("p", {}, "Too many people excluded each other. There's no valid way to match everyone up. Start a new event and go easier on the 🚫 list."),
      h("a", { class: "btn pink", href: "./" }, "New event"))];
  }
  return [h("section", { class: "card yellow center" },
    h("span", { class: "big-emoji" }, "🎰"),
    h("h2", {}, "Shaking the hat…"),
    h("p", {}, "Drawing names. This page updates on its own."))];
}

// ---------------------------------------------------------------------
// After the draw: your giftee, reveal, turkey court
// ---------------------------------------------------------------------
function santaView() {
  const out = [];
  const a = S.assignment;
  if (a === undefined) return [h("div", { class: "card loading" }, "Checking the naughty list…")];
  if (!a) {
    return [h("section", { class: "card yellow" },
      h("h2", {}, "🤷 You're not in this draw"),
      h("p", {}, "Looks like you weren't signed up when names were drawn."))];
  }

  if (S.phase === "revealed") out.push(...revealedCards());

  // Giftee card: the main thing on the page
  const budget = S.event.budget || BUDGET;
  const budgetBanner = () => h("div", { class: "budget-banner" },
    h("span", { class: "budget-amount" }, `$${budget}`),
    h("span", {}, h("b", {}, "MAX. Do NOT go over."), ` Spend more than $${budget} and you're getting roasted like a turkey in Turkey Court 🦃🔥`));
  const gifteeCard = h("section", { class: "card pink center giftee-hero" });
  const showGiftee = (fresh) => {
    gifteeCard.replaceChildren(
      h("h2", {}, "🎯 YOU'RE BUYING FOR"),
      h("div", { class: "giftee-name" }, nameOf(a.gifteeUid)),
      h("div", { id: "gifteeDelivery", style: "text-align:left" }),
      budgetBanner(),
    );
    updateGifteeDelivery();
    if (fresh) confetti(220);
  };
  if (seen("giftee") || S.phase === "revealed") {
    showGiftee(false);
  } else {
    gifteeCard.append(
      h("h2", {}, "YOUR GIFTEE IS IN THIS BOX"),
      h("button", { class: "gift-box", type: "button", "aria-label": "Unwrap", onclick: () => { markSeen("giftee"); showGiftee(true); } }, "🎁"),
      h("p", {}, "Make sure nobody's looking at your screen. Then click it."),
      budgetBanner(),
    );
  }
  out.push(gifteeCard);

  if (S.phase === "drawn") {
    out.push(h("section", { class: "card" },
      h("h3", {}, "Your own gift goes to:"),
      h("div", { id: "myDelivery" })));
    queueMicrotask(updateMyDelivery);
  }
  return out;
}

function updateGifteeDelivery() {
  const box = document.getElementById("gifteeDelivery");
  if (!box) return;
  const p = S.gifteePrivate;
  if (!p) {
    box.replaceChildren(h("p", {}, "They haven't added where to send it yet. Check back soon."));
    return;
  }
  box.replaceChildren(
    h("p", {}, p.deliveryType === "physical" ? "📦 Ship it to:" : "💻 They want a virtual gift. Send it to:"),
    h("div", { class: "delivery" }, p.deliveryInfo),
  );
}

// ---------------------------------------------------------------------
// Reveal + Turkey Court
// ---------------------------------------------------------------------
function revealedCards() {
  const revealCard = h("section", { class: "card blue tilt-r center" },
    h("span", { class: "big-emoji" }, "🥁"),
    h("h2", {}, "IT'S REVEAL TIME"),
    h("p", {}, "Get everyone in a Discord call and share your screen."),
    h("button", { class: "btn yellow huge", type: "button", onclick: startRevealShow }, "▶ START THE SHOW"),
  );
  const court = h("section", { class: "card yellow tilt-l" },
    h("h2", {}, "🦃⚖️ TURKEY COURT"),
    h("p", {}, `Did your Santa blow past the $${S.event.budget || BUDGET} limit? File charges. The court will roast them publicly.`),
    h("div", { id: "fileCharges" }),
    h("hr", { class: "divider" }),
    h("h3", {}, "🔥 WALL OF SHAME 🔥"),
    h("div", { class: "shame-list", id: "shame" }),
  );
  loadRevealData();
  return [revealCard, court];
}

function loadRevealData() {
  if (!S._revealSub) {
    S._revealSub = onSnapshot(doc(db, "events", eventId, "reveal", "pairs"), (s) => {
      S.reveal = s.exists() ? s.data() : null;
      updateCourt();
    }, (e) => console.warn("reveal", e.code));
    unsubs.user.push(() => { S._revealSub?.(); S._revealSub = null; });
  }
  if (!S._flagsSub) {
    S._flagsSub = onSnapshot(collection(db, "events", eventId, "flags"), (s) => {
      S.flags = s.docs.map((d) => ({ id: d.id, ...d.data() }));
      updateCourt();
    }, (e) => console.warn("flags", e.code));
    unsubs.user.push(() => { S._flagsSub?.(); S._flagsSub = null; });
  }
  queueMicrotask(updateCourt);
}

function updateCourt() {
  const fileBox = document.getElementById("fileCharges");
  const shame = document.getElementById("shame");
  if (!fileBox || !shame) return;
  const mySanta = S.reveal?.santaOf?.[S.user.uid];
  const myFlag = S.flags.find((f) => f.id === S.user.uid);

  if (!S.reveal) {
    fileBox.replaceChildren(h("p", { class: "muted" }, "Loading the evidence…"));
  } else if (myFlag) {
    fileBox.replaceChildren(
      h("p", {}, `You charged ${nameOf(myFlag.santaUid)} with overspending. Justice is served. 🦃`),
      h("button", {
        class: "btn ghost small", type: "button",
        onclick: async () => { try { await deleteDoc(doc(db, "events", eventId, "flags", S.user.uid)); toast("Charges dropped. How merciful."); } catch (e) { toast(e.message); } },
      }, "Drop the charges"));
  } else if (mySanta) {
    const ev = h("input", { maxlength: 300, placeholder: "Evidence (optional): \"that hoodie is $45, I checked\"" });
    fileBox.replaceChildren(
      h("p", {}, "Your Santa was ", h("b", {}, nameOf(mySanta)), "."),
      h("div", { class: "stack" }, ev,
        h("button", {
          class: "btn pink", type: "button",
          onclick: async () => {
            try {
              await setDoc(doc(db, "events", eventId, "flags", S.user.uid), { santaUid: mySanta, evidence: ev.value.trim(), at: serverTimestamp() });
              confetti(80);
              toast(`${nameOf(mySanta)} has been dragged to Turkey Court. 🦃🔥`);
            } catch (e) { toast("Couldn't file: " + e.message); }
          },
        }, "🦃 THEY WENT OVER BUDGET")));
  }

  if (!S.flags.length) {
    shame.replaceChildren(h("p", { class: "muted" }, "Empty… for now. Everyone stayed under budget? Suspicious."));
    return;
  }
  shame.replaceChildren(...S.flags.map((f) => {
    const santa = nameOf(f.santaUid);
    return h("div", { class: "shame" },
      h("div", { class: "turkey" }, "🦃"),
      h("div", {},
        h("h3", {}, `${santa}: GUILTY`),
        h("p", { class: "roast" }, roastFor(santa, f.santaUid + f.id)),
        h("p", { class: "evidence" }, `Charged by ${nameOf(f.id)}`, f.evidence ? ` · Evidence: "${f.evidence}"` : "")));
  }));
}

async function startRevealShow() {
  let reveal = S.reveal;
  if (!reveal) {
    try {
      const s = await getDoc(doc(db, "events", eventId, "reveal", "pairs"));
      reveal = s.exists() ? s.data() : null;
    } catch (e) {
      toast("Not reveal time yet (according to the server). Hold tight.");
      return;
    }
  }
  if (!reveal) return toast("No reveal data found.");

  // Order as a chain where possible: each reveal's santa is the next giftee.
  const santaOf = reveal.santaOf;
  const order = [];
  const remaining = new Set(Object.keys(santaOf));
  while (remaining.size) {
    let g = shuffle([...remaining])[0];
    while (g && remaining.has(g)) {
      order.push(g);
      remaining.delete(g);
      g = santaOf[g];
    }
  }

  let i = 0;
  const q = h("div", { class: "reveal-q" });
  const a = h("div", { class: "reveal-a" });
  const progress = h("div", { class: "reveal-progress" });
  const btn = h("button", { class: "btn yellow huge", type: "button" });
  const stage = h("div", { class: "reveal-stage", role: "dialog", "aria-label": "Reveal show" },
    h("button", { class: "btn ghost small close", type: "button", onclick: () => stage.remove() }, "✕ EXIT"),
    h("div", { class: "reveal-inner" }, progress, q, a, btn));
  document.body.append(stage);

  let state = "ask";
  const step = () => {
    if (i >= order.length) {
      progress.textContent = "";
      q.replaceChildren("THAT'S EVERYONE! 🎄");
      a.className = "reveal-a revealed";
      a.textContent = "🦃 TO TURKEY COURT 🦃";
      btn.textContent = "BACK TO THE SITE";
      btn.onclick = () => stage.remove();
      confetti(300);
      return;
    }
    const g = order[i];
    progress.textContent = `${i + 1} / ${order.length}`;
    if (state === "ask") {
      q.replaceChildren("WHO WAS THE SECRET SANTA FOR…", h("span", { class: "giftee" }, nameOf(g)));
      a.className = "reveal-a";
      a.textContent = "❓❓❓";
      btn.textContent = "🥁 REVEAL";
      btn.disabled = false;
      state = "roll";
    } else if (state === "roll") {
      btn.disabled = true;
      a.className = "reveal-a drumroll";
      const names = S.participants.map((p) => p.name);
      const spin = setInterval(() => { a.textContent = names[(Math.random() * names.length) | 0] || "🎄"; }, 70);
      setTimeout(() => {
        clearInterval(spin);
        a.className = "reveal-a revealed";
        a.textContent = nameOf(santaOf[g]);
        confetti(220);
        btn.disabled = false;
        btn.textContent = i + 1 < order.length ? "NEXT VICTIM ➜" : "FINALE ➜";
        state = "next";
      }, 2300);
    } else {
      i++;
      state = "ask";
      step();
      return;
    }
  };
  btn.onclick = step;
  step();
}

// ======================================================================
// Boot
// ======================================================================
if (eventId) startEvent();
else renderLanding();
