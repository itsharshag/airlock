// Airlock: a browser for AI agents that spend money on NEAR.
//
// Three things it does that a Chromium extension cannot:
//  1. Pins a dapp's frontend. Every response from a pinned origin is hashed
//     before the page sees it. Changed or new files are refused.
//  2. Keeps the approve button out of the agent's reach. The agent drives the
//     page through a control API that only addresses the page. Approvals live in
//     a separate window (plus Touch ID on macOS), and remote debugging is refused.
//  3. Signs in the main process with a scoped function-call key, so a
//     compromised page or a prompt-injected agent never holds a key.
const { app, BrowserWindow, WebContentsView, Menu, ipcMain, session, systemPreferences } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PinStore } = require('./guard/pins');
const { evaluate, chainLookup } = require('./guard/verdict');
const { makeSigner, NETWORKS } = require('./signer');

for (const sw of ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk']) {
  if (app.commandLine.hasSwitch(sw) || process.argv.some(a => a.startsWith('--' + sw))) {
    console.error(`[airlock] refusing to start with --${sw}: it would let an automation client reach the approval window`);
    process.exit(2);
  }
}

const ROOT = path.join(__dirname, '..');
const PROFILE = process.env.AIRLOCK_PROFILE || path.join(ROOT, 'profile');
const NETWORK = process.env.AIRLOCK_NETWORK || 'testnet';
const NET = NETWORKS[NETWORK];
const AUTODECIDE = process.env.AIRLOCK_DEMO_AUTODECIDE || ''; // e.g. "deny:4000" for unattended demo recordings
const START_URL = process.env.AIRLOCK_START_URL || 'about:blank';
fs.mkdirSync(PROFILE, { recursive: true });

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const pins = new PinStore(path.join(PROFILE, 'pins.json'));
const blocklistFile = path.join(PROFILE, 'blocklist.json');
if (!fs.existsSync(blocklistFile)) fs.copyFileSync(path.join(ROOT, 'config', 'blocklist.json'), blocklistFile);
const historyFile = path.join(PROFILE, 'history.json');
const known = readJson(path.join(ROOT, 'config', 'known-accounts.json'), []);
const agentKey = readJson(path.join(ROOT, '.keys', 'agent.json'), null);
const ownerKey = readJson(path.join(ROOT, '.keys', 'owner.json'), null);
const lookup = chainLookup({ rpc: NET.nodeUrl, nearblocks: NET.nearblocks });

let win, page, lastAgentCall = 0;
const tampered = new Map(); // origin -> { ok:false, path }
let pendingPin = null;
const log = (type, data) => {
  console.log(`[airlock] ${type} ${JSON.stringify(data)}`);
  win?.webContents.send('event', { type, at: Date.now(), ...data });
};

// ---------- 1. frontend pinning, below the page ----------
function interceptNetwork(ses) {
  const handler = async (req) => {
    const res = await ses.fetch(req, { bypassCustomProtocolHandlers: true });
    const u = new URL(req.url);
    // Pin code, not data: HTML, scripts, styles and wasm. API responses change by design.
    const type = res.headers.get('content-type') || '';
    const isCode = /html|javascript|ecmascript|css|wasm/.test(type) || /\.(m?js|css|wasm|html?)$/.test(u.pathname) || u.pathname === '/';
    if (!pins.isPinned(u.origin) || res.status >= 400 || !isCode) return res;
    const body = Buffer.from(await res.arrayBuffer());
    const r = pins.check(req.url, body);
    const headers = new Headers(res.headers);
    headers.delete('content-length'); headers.delete('content-encoding');
    if (r.ok) return new Response(body, { status: res.status, headers });
    tampered.set(u.origin, { ok: false, path: u.pathname });
    log('frontend-blocked', { origin: u.origin, path: u.pathname, reason: r.reason, expected: r.expected, got: r.got });
    const isDoc = req.destination === 'document' || /text\/html/.test(res.headers.get('content-type') || '');
    if (isDoc) {
      return new Response(fs.readFileSync(path.join(__dirname, 'ui', 'blocked.html'), 'utf8')
        .replace('{{PATH}}', u.pathname).replace('{{ORIGIN}}', u.origin), { status: 451, headers: { 'content-type': 'text/html' } });
    }
    return new Response(`/* Airlock refused ${u.pathname}: it changed since this site was pinned */`, { status: 451, headers: { 'content-type': 'text/javascript' } });
  };
  ses.protocol.handle('https', handler);
  ses.protocol.handle('http', handler);
}

// ---------- 2. approvals live outside the page ----------
const approvals = new Map();
function askHuman(request) {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const pb = win.getBounds();
    const w = new BrowserWindow({
      width: 540, height: 600, x: pb.x + Math.round((pb.width - 400 - 540) / 2), y: pb.y + 150, frame: false, parent: win, modal: true, resizable: false, title: 'Airlock: approve?',
      backgroundColor: '#0b0d10',
      webPreferences: { preload: path.join(__dirname, 'ui', 'approve-preload.js'), partition: 'airlock-approval', sandbox: true, contextIsolation: true },
    });
    approvals.set(id, { request, resolve, w, autodecide: AUTODECIDE });
    w.loadFile(path.join(__dirname, 'ui', 'approve.html'), { hash: id });
    w.on('closed', () => { if (approvals.has(id)) { approvals.delete(id); resolve(false); } });
  });
}
ipcMain.handle('approval:get', (e, id) => {
  const a = approvals.get(id);
  return a && a.w.webContents === e.sender ? { ...a.request, autodecide: a.autodecide } : null;
});
ipcMain.handle('approval:decide', async (e, id, yes) => {
  const a = approvals.get(id);
  if (!a || a.w.webContents !== e.sender) return false;
  if (yes && process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
    try { await systemPreferences.promptTouchID(`approve ${a.request.summary.join(', ')} to ${a.request.tx.receiverId}`); }
    catch { return false; }
  }
  approvals.delete(id); a.w.close(); a.resolve(!!yes);
  return true;
});

// ---------- 3. the signing guard ----------
let signers = null;
async function getSigners() {
  if (!signers) signers = {
    agent: agentKey && await makeSigner({ networkId: NETWORK, accountId: agentKey.accountId, secretKey: agentKey.secretKey }),
    owner: ownerKey && await makeSigner({ networkId: NETWORK, accountId: ownerKey.accountId, secretKey: ownerKey.secretKey }),
  };
  return signers;
}

ipcMain.handle('near:account', (e) => (e.sender === page?.webContents ? agentKey?.accountId || null : null));
ipcMain.handle('near:sign', async (e, tx) => {
  if (e.sender !== page?.webContents) throw new Error('not the page');
  const origin = new URL(e.senderFrame.url).origin;
  const actor = Date.now() - lastAgentCall < 15000 ? 'agent' : 'human';
  const cfg = { agentKey, knownAccounts: known, blocklist: readJson(blocklistFile, []), history: readJson(historyFile, []) };
  const result = await evaluate(tx, { origin, actor, frontend: tampered.get(origin) }, cfg, lookup);
  log('verdict', { origin, actor, tx, ...result });
  if (result.verdict === 'block') return { ok: false, verdict: 'block', reasons: result.reasons.filter(r => r.level === 'block').map(r => r.text) };
  if (result.verdict === 'warn') {
    const yes = await askHuman({ tx, origin, actor, ...result });
    log('human', { approved: yes, receiverId: tx.receiverId });
    if (!yes) return { ok: false, verdict: 'warn', reasons: ['Declined in the approval window.'] };
  }
  const s = await getSigners();
  const signer = result.verdict === 'allow' ? s.agent : s.owner;
  try {
    const sent = await signer.send(tx);
    const hist = readJson(historyFile, []);
    if (!hist.includes(tx.receiverId)) { hist.push(tx.receiverId); fs.writeFileSync(historyFile, JSON.stringify(hist)); }
    log('signed', { by: result.verdict === 'allow' ? 'agent function-call key' : 'owner (human approved)', hash: sent.hash, explorer: NET.explorer + sent.hash });
    return { ok: true, verdict: result.verdict, hash: sent.hash };
  } catch (err) {
    log('chain-error', { message: String(err.message || err).slice(0, 300) });
    return { ok: false, verdict: result.verdict, reasons: [String(err.message || err).slice(0, 300)] };
  }
});

// ---------- chrome (address bar + shield panel) ----------
ipcMain.handle('ui:navigate', (_e, url) => page.webContents.loadURL(/^[a-z]+:/.test(url) ? url : 'https://' + url));
ipcMain.handle('ui:reload', () => page.webContents.reload());
ipcMain.handle('ui:back', () => page.webContents.navigationHistory.canGoBack() && page.webContents.navigationHistory.goBack());
ipcMain.handle('ui:pin', () => {
  const origin = new URL(page.webContents.getURL()).origin;
  if (pins.isPinned(origin)) { pins.unpin(origin); tampered.delete(origin); sendState(); return; }
  pins.startPinning(origin); pendingPin = origin;
  page.webContents.session.clearCache().then(() => page.webContents.reloadIgnoringCache());
});
function sendState() {
  const url = page.webContents.getURL();
  let origin = ''; try { origin = new URL(url).origin; } catch {}
  win.webContents.send('state', {
    url, title: page.webContents.getTitle(), pinned: pins.isPinned(origin),
    pinnedFiles: Object.keys(pins.pins[origin] || {}).length, tampered: tampered.get(origin) || null,
    agentActive: Date.now() - lastAgentCall < 15000, account: agentKey?.accountId, network: NETWORK,
    agentScope: agentKey ? `${agentKey.receiverId} · ${agentKey.methodNames.join(', ')}` : 'none',
  });
}

function layout() {
  const [w, h] = win.getContentSize();
  page.setBounds({ x: 0, y: 88, width: w - 400, height: h - 88 });
}

function createWindow() {
  const [W, H] = (process.env.AIRLOCK_SIZE || '1440x900').split('x').map(Number);
  win = new BrowserWindow({
    width: W, height: H, x: 0, y: 0, title: 'Airlock', backgroundColor: '#16181c',
    frame: process.platform === 'darwin', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    webPreferences: { preload: path.join(__dirname, 'ui', 'chrome-preload.js'), sandbox: true, contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'ui', 'chrome.html'));
  const ses = session.fromPartition('persist:airlock-web');
  interceptNetwork(ses);
  page = new WebContentsView({ webPreferences: { session: ses, preload: path.join(__dirname, 'provider-preload.js'), sandbox: true, contextIsolation: true } });
  win.contentView.addChildView(page);
  layout(); win.on('resize', layout);
  page.webContents.setWindowOpenHandler(({ url }) => { page.webContents.loadURL(url); return { action: 'deny' }; });
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'page-title-updated']) page.webContents.on(ev, sendState);
  page.webContents.on('did-start-navigation', (_e, url, inPage, isMain) => {
    if (isMain && !inPage) { try { const o = new URL(url).origin; if (o !== pendingPin) tampered.delete(o); } catch {} }
  });
  page.webContents.on('did-finish-load', () => {
    if (pendingPin) {
      const o = pendingPin; pendingPin = null; pins.finishPinning(o);
      log('pinned', { origin: o, files: Object.keys(pins.pins[o]) });
    }
    sendState();
  });
  // Origins pinned before first use (a pin list shipped with the browser, or published by the dapp).
  for (const o of (process.env.AIRLOCK_PINS || '').split(',').filter(Boolean)) {
    if (!pins.isPinned(o)) { pins.startPinning(o); pendingPin = o; }
  }
  setInterval(sendState, 2000);
  page.webContents.loadURL(START_URL);
}

// ---------- agent control API: reaches the page, nothing else ----------
function startAgentApi() {
  const token = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(PROFILE, 'agent-api.json'), JSON.stringify({ url: 'http://127.0.0.1:7777', token }), { mode: 0o600 });
  const wc = () => page.webContents;
  const routes = {
    'POST /open': async (b) => { await wc().loadURL(b.url); return { url: wc().getURL() }; },
    'GET /read': async () => ({ url: wc().getURL(), title: wc().getTitle(), text: await wc().executeJavaScript('document.body ? document.body.innerText : ""') }),
    'POST /click': async (b) => ({ clicked: await wc().executeJavaScript(`(() => { const t = ${JSON.stringify(b.text || '')}; const el = ${b.selector ? `document.querySelector(${JSON.stringify(b.selector)})` : `[...document.querySelectorAll('button,a,[role=button]')].find(e => e.innerText.trim().toLowerCase().includes(t.toLowerCase()))`}; if (!el) return false; el.click(); return true; })()`, true) }),
    'POST /eval': async (b) => ({ result: await wc().executeJavaScript(b.js, true) }),
    'POST /key': async (b) => { wc().sendInputEvent({ type: 'keyDown', keyCode: b.key }); wc().sendInputEvent({ type: 'keyUp', keyCode: b.key }); return { sent: b.key, to: 'page' }; },
    // Demo recordings only: a caption banner in the Shield panel. Off unless AIRLOCK_DEMO_CAPTIONS=1.
    ...(process.env.AIRLOCK_DEMO_CAPTIONS === '1' ? { 'POST /caption': async (b) => { win.webContents.send('caption', b.text); return {}; } } : {}),
    // Demo recordings only: plays the attacker by setting the demo server's swap cookie in this browser.
    ...(process.env.AIRLOCK_DEMO === '1' ? { 'POST /demo/attacker-swap': async (b) => { await wc().session.cookies.set({ url: b.url, name: 'swapped', value: b.on ? '1' : '0' }); return {}; } } : {}),
    'GET /windows': async () => ({ windows: ['page'], note: 'Approval windows are not addressable from the agent API.' }),
  };
  http.createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'bad token' });
    let body = ''; for await (const c of req) body += c;
    const route = routes[`${req.method} ${req.url.split('?')[0]}`];
    lastAgentCall = Date.now();
    const b = body ? JSON.parse(body) : {};
    if (route && req.method === 'POST' && !/^\/(caption|demo\/)/.test(req.url)) log('agent', { route: req.url, detail: b.url || b.text || b.selector || (b.js ? 'runs a script in the page' : b.key || '') });
    if (!route) { log('agent-denied', { route: `${req.method} ${req.url}` }); return send(404, { error: `No such endpoint. Approvals belong to the human.` }); }
    try { send(200, await route(b)); } catch (e) { send(500, { error: String(e.message || e) }); }
  }).listen(7777, '127.0.0.1');
}

app.whenReady().then(() => { if (process.platform !== 'darwin') Menu.setApplicationMenu(null); createWindow(); startAgentApi(); });
app.on('window-all-closed', () => app.quit());
