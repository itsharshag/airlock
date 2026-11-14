// Lookalike NEAR account detection: "near-0fficial.testnet" vs "near-official.testnet".
const HOMOGLYPHS = { '0': 'o', '1': 'l', '3': 'e', '5': 's', '7': 't', 'i': 'l', '_': '-' };

function skeleton(id) {
  return id.toLowerCase().replace(/rn/g, 'm').replace(/vv/g, 'w')
    .split('').map(c => HOMOGLYPHS[c] || c).join('')
    .replace(/(.)\1+/g, '$1');
}

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Returns the known account this one imitates, or null.
function imitates(id, known) {
  if (known.includes(id)) return null;
  const s = skeleton(id);
  for (const k of known) {
    if (skeleton(k) === s) return k;
    const base = x => x.replace(/\.(testnet|near)$/, '');
    if (base(k).length >= 5 && distance(base(id), base(k)) <= 2) return k;
  }
  return null;
}

module.exports = { imitates, skeleton, distance };
