// Frontend pinning: every response from a pinned origin must match the hash
// recorded for its path. A swapped bundle (the Bybit / Safe{Wallet} attack) or a
// script that was never there before is refused before the page can run it.
// Chromium extensions cannot do this: they never see response bodies.
const crypto = require('crypto');
const fs = require('fs');

const IGNORED = new Set(['/favicon.ico']);

class PinStore {
  constructor(file) {
    this.file = file;
    this.pins = {}; // origin -> { path -> sha256 }
    this.learning = new Set(); // origins being pinned on this load (trust on first use)
    try { this.pins = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  }

  save() { if (this.file) fs.writeFileSync(this.file, JSON.stringify(this.pins, null, 2)); }

  static hash(buf) { return 'sha256-' + crypto.createHash('sha256').update(buf).digest('base64'); }

  isPinned(origin) { return !!this.pins[origin]; }

  startPinning(origin) { this.pins[origin] = {}; this.learning.add(origin); }
  finishPinning(origin) { this.learning.delete(origin); this.save(); }
  unpin(origin) { delete this.pins[origin]; this.learning.delete(origin); this.save(); }

  // Returns { ok: true } or { ok: false, reason, expected, got }.
  check(url, body) {
    const u = new URL(url);
    const origin = u.origin;
    const path = u.pathname;
    if (!this.pins[origin] || IGNORED.has(path)) return { ok: true, pinned: false };
    const got = PinStore.hash(body);
    if (this.learning.has(origin)) {
      this.pins[origin][path] = got;
      return { ok: true, pinned: true, learned: true };
    }
    const expected = this.pins[origin][path];
    if (!expected) return { ok: false, reason: 'new-file', path, got };
    if (expected !== got) return { ok: false, reason: 'changed', path, expected, got };
    return { ok: true, pinned: true };
  }
}

module.exports = { PinStore };
