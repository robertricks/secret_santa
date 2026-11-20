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
