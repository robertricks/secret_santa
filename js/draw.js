// Secret Santa draw: a random assignment santa -> giftee where nobody draws
// themselves and nobody draws someone they (or who) excluded. Tries to avoid
// mutual pairs (A gets B and B gets A) first, then relaxes that if needed.

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
 * @returns {Map<string,string>|null} santa -> giftee, or null if impossible
 */
export function makeDraw(ids, exclusionPairs = []) {
  if (ids.length < 2) return null;
  const blocked = new Set();
  for (const [a, b] of exclusionPairs) {
    blocked.add(a + "|" + b);
    blocked.add(b + "|" + a);
  }
  const allowed = (s, g) => s !== g && !blocked.has(s + "|" + g);

  for (const avoidMutual of [true, false]) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const res = tryOnce(shuffle(ids), allowed, avoidMutual);
      if (res) return res;
    }
  }
  return null;
}

function tryOnce(santas, allowed, avoidMutual) {
  const options = new Map(santas.map((s) => [s, shuffle(santas.filter((g) => allowed(s, g)))]));
  // Most-constrained santas first.
  const order = [...santas].sort((a, b) => options.get(a).length - options.get(b).length);
  const used = new Set();
  const assign = new Map();
  let steps = 0;

  function go(i) {
    if (++steps > 50000) return false;
    if (i === order.length) return true;
    const s = order[i];
    for (const g of options.get(s)) {
      if (used.has(g)) continue;
      if (avoidMutual && assign.get(g) === s) continue;
      used.add(g);
      assign.set(s, g);
      if (go(i + 1)) return true;
      used.delete(g);
      assign.delete(s);
    }
    return false;
  }
  return go(0) ? assign : null;
}
