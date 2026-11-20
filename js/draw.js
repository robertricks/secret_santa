// Secret Santa draw: a random assignment santa -> giftee where nobody draws
// themselves and nobody draws someone they (or who) excluded.
//
// Preferences, in order:
//   1. Avoid mutual pairs (A gets B and B gets A) when possible.
//   2. Keep gift types together: 📦 address people buy for address people and
//      💻 virtual people buy for virtual people. If that's impossible (a type
//      with only one or two people, or exclusions get in the way), use as few
//      cross-type matches as possible.
// People with no known gift type can be matched with anyone.

function randInt(n) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * @param {string[]} ids participant ids
 * @param {Array<[string,string]>} exclusionPairs [a, b] means a and b must not draw each other (either way)
 * @param {Map<string,string>|Object} [typeOf] id -> "physical" | "virtual" (missing = no preference)
 * @returns {Map<string,string>|null} santa -> giftee, or null if impossible
 */
export function makeDraw(ids, exclusionPairs = [], typeOf = new Map()) {
  if (ids.length < 2) return null;
  const type = typeOf instanceof Map ? (id) => typeOf.get(id) : (id) => typeOf[id];
  const blocked = new Set();
  for (const [a, b] of exclusionPairs) {
    blocked.add(a + "|" + b);
    blocked.add(b + "|" + a);
  }
  const allowed = (s, g) => s !== g && !blocked.has(s + "|" + g);
  const isCross = (s, g) => {
    const ts = type(s);
    const tg = type(g);
    return Boolean(ts && tg && ts !== tg);
  };

  // Avoid mutual pairs first (with only 2 people of a type, a mutual pair would let
  // both of them work out who their Santa is), then use the fewest cross-type matches.
  for (const avoidMutual of [true, false]) {
    for (let maxCross = 0; maxCross <= ids.length; maxCross++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const res = tryOnce(shuffle(ids), allowed, isCross, maxCross, avoidMutual);
        if (res) return res;
      }
    }
  }
  return null;
}

/** How many santa -> giftee matches cross gift types (for reporting/tests). */
export function crossCount(assign, typeOf) {
  const type = typeOf instanceof Map ? (id) => typeOf.get(id) : (id) => typeOf[id];
  let n = 0;
  for (const [s, g] of assign) if (type(s) && type(g) && type(s) !== type(g)) n++;
  return n;
}

function tryOnce(santas, allowed, isCross, maxCross, avoidMutual) {
  // Same-type options first (in random order), cross-type options after.
  const options = new Map(santas.map((s) => {
    const opts = shuffle(santas.filter((g) => allowed(s, g)));
    return [s, [...opts.filter((g) => !isCross(s, g)), ...opts.filter((g) => isCross(s, g))]];
  }));
  // Most-constrained santas first: fewest same-type options, then fewest options overall.
  const sameCount = (s) => options.get(s).filter((g) => !isCross(s, g)).length;
  const order = [...santas].sort((a, b) => sameCount(a) - sameCount(b) || options.get(a).length - options.get(b).length);
  const used = new Set();
  const assign = new Map();
  let crosses = 0;
  let steps = 0;

  function go(i) {
    if (++steps > 20000) return false;
    if (i === order.length) return true;
    const s = order[i];
    for (const g of options.get(s)) {
      if (used.has(g)) continue;
      if (avoidMutual && assign.get(g) === s) continue;
      const c = isCross(s, g) ? 1 : 0;
      if (crosses + c > maxCross) continue;
      used.add(g);
      assign.set(s, g);
      crosses += c;
      if (go(i + 1)) return true;
      crosses -= c;
      used.delete(g);
      assign.delete(s);
    }
    return false;
  }
  return go(0) ? assign : null;
}

/**
 * Turn an organizer's draft into a full, valid draw for the current players.
 * - People in the draft who are no longer playing are spliced out (their Santa
 *   takes over their giftee).
 * - People who joined after the draft are slotted into the chain where they fit
 *   best (respecting exclusions and gift types when possible).
 * @param {Object<string,string>} santaOfDraft giftee -> santa (as saved in the draft)
 * @returns {Map<string,string>|null} santa -> giftee, or null if the draft can't be used
 */
export function applyDraft(santaOfDraft, ids, exclusionPairs = [], typeOf = new Map()) {
  const idSet = new Set(ids);
  const type = typeOf instanceof Map ? (id) => typeOf.get(id) : (id) => typeOf[id];
  const blocked = new Set();
  for (const [a, b] of exclusionPairs) { blocked.add(a + "|" + b); blocked.add(b + "|" + a); }
  const allowed = (s, g) => s !== g && !blocked.has(s + "|" + g);
  const cross = (s, g) => Boolean(type(s) && type(g) && type(s) !== type(g));

  const next = new Map(); // santa -> giftee
  for (const [g, s] of Object.entries(santaOfDraft || {})) next.set(s, g);
  // Splice out anyone no longer playing.
  const loose = [];
  for (const x of [...next.keys()]) {
    if (idSet.has(x) || !next.has(x)) continue;
    const g = next.get(x);
    const s = [...next].find(([, gg]) => gg === x)?.[0];
    next.delete(x);
    if (s === undefined) continue;
    if (s === g) { next.delete(s); loose.push(s); } else next.set(s, g);
  }

  // Slot in newcomers (and anyone knocked loose above).
  const newcomers = shuffle([...ids.filter((id) => !next.has(id)), ...loose.filter((id) => idSet.has(id) && !next.has(id))]);
  for (const n of [...new Set(newcomers)]) {
    if (next.size < 2) return null;
    let best = null;
    let bestScore = Infinity;
    for (const [s, g] of shuffle([...next])) {
      const score = (allowed(s, n) ? 0 : 10) + (allowed(n, g) ? 0 : 10) + (cross(s, n) ? 1 : 0) + (cross(n, g) ? 1 : 0)
        + (next.get(g) === n ? 5 : 0);
      if (score < bestScore) { bestScore = score; best = [s, g]; }
    }
    if (!best || bestScore >= 10) return null; // no slot that respects the exclusions
    const [s, g] = best;
    next.set(s, n);
    next.set(n, g);
  }

  // Final check: everyone gives once, gets once, never to themselves.
  const ok = next.size === idSet.size && [...next.keys()].every((s) => idSet.has(s))
    && new Set(next.values()).size === next.size && [...next.values()].every((g) => idSet.has(g))
    && [...next].every(([s, g]) => s !== g);
  return ok ? next : null;
}
