// Demo sites: the Tip Jar dapp on :4001 and a news page with a hidden prompt
// injection on :4002. POST /__attacker/swap on :4001 swaps app.js for the
// draining version, the way an attacker swaps a dapp's bundle in its bucket.
// GET /__attacker/swap?on=1 (opened inside Airlock) does the same for that one
// browser only, via a cookie, so the hosted copy stays usable for everyone else.
// Ports: TIPJAR_PORT (4001), NEWS_PORT (4002).
const http = require('http'); const fs = require('fs'); const path = require('path');
let swapped = false;
const payee = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.keys', 'payee.json'))).accountId; } catch { return 'airlock-tipjar.testnet'; } })();
const serve = (dir, extra) => (req, res) => {
  const u = req.url.split('?')[0];
  if (extra && extra(req, res, u)) return;
  let f = u === '/' ? 'index.html' : u.slice(1);
  if (f === 'app.js' && (swapped || /(^|; )swapped=1/.test(req.headers.cookie || ''))) f = 'app.evil.js';
  fs.readFile(path.join(__dirname, dir, f), (e, b) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html', 'cache-control': 'no-store' }); res.end(b);
  });
};
http.createServer(serve('tipjar', (req, res, u) => {
  if (u === '/payee') { res.end(payee); return true; }
  if (u === '/__attacker/swap' && req.method === 'GET') {
    const on = /on=1/.test(req.url);
    res.writeHead(302, { 'set-cookie': `swapped=${on ? 1 : 0}; Path=/; SameSite=Lax`, location: '/' }); res.end(); return true;
  }
  if (u === '/__attacker/swap' && !req.headers['x-forwarded-for']) { swapped = req.method === 'POST'; console.log('[attacker] app.js swapped:', swapped); res.end(String(swapped)); return true; }
})).listen(Number(process.env.TIPJAR_PORT || 4001), '127.0.0.1');
http.createServer(serve('news')).listen(Number(process.env.NEWS_PORT || 4002), '127.0.0.1');
console.log('tipjar http://127.0.0.1:4001  news http://127.0.0.1:4002  payee', payee);
