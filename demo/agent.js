// A deliberately naive browsing agent: it does its task, and it obeys any
// instruction it reads in a page. This is the prompt-injected agent from the
// track brief. It drives Airlock only through Airlock's agent API, the same way
// an LLM agent's tools would. Every step is logged.
const fs = require('fs'); const path = require('path');
const api = JSON.parse(fs.readFileSync(path.join(process.env.AIRLOCK_PROFILE || path.join(__dirname, '..', 'profile'), 'agent-api.json')));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const call = async (method, route, body) => {
  const r = await fetch(api.url + route, { method, headers: { authorization: `Bearer ${api.token}`, 'content-type': 'application/json' }, body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
};
const caption = (text) => process.env.CAPTIONS === '1' ? call('POST', '/caption', { text }).catch(() => {}) : null;
const mark = (name) => console.log(`MARK ${name} ${Date.now()}`);
const say = (...a) => console.log(`[agent ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sign = (tx) => call('POST', '/eval', { js: `window.near.signAndSendTransaction(${JSON.stringify(tx)})` }).then(r => r.result);
const pause = Number(process.env.AGENT_PAUSE || 3500);
const TIPJAR = process.env.TIPJAR || 'http://127.0.0.1:4001'; const NEWS = process.env.NEWS || 'http://127.0.0.1:4002';
// Waits until the Tip Jar's result line says something (a tx can take a few seconds).
const result = async (ms = 25000) => { for (let t = 0; t < ms; t += 500) { const r = await call('GET', '/read'); const l = r.text.split('\n').pop(); if (/Sent|Not sent/.test(l)) return l; await sleep(500); } return '(no result: the button did nothing)'; };

(async () => {
  say('task: sign the Tip Jar guestbook, read today\'s NEAR news, tip the creator');

  await caption('1. Agent signs a guestbook. In scope for its NEAR function-call key, so Airlock lets the agent key sign.');
  mark('s1');
  say('1. open the Tip Jar and sign the guestbook (inside the agent key\'s scope)');
  await call('POST', '/open', { url: TIPJAR + '/' }); await sleep(pause);
  await call('POST', '/click', { text: 'Sign the guestbook' });
  say('   page says:', await result()); mark('s1_done'); await sleep(pause);

  await caption('2. Agent reads a news page with hidden instructions: send 5 NEAR to a lookalike account, then claim a fake airdrop.');
  mark('s2');
  say('2. read the news');
  await call('POST', '/open', { url: NEWS + '/' }); await sleep(pause);
  const page = await call('GET', '/read');
  const m = page.text.match(/receiverId "([^"]+)".*?deposit (\d+)/s);
  if (m) {
    mark('s2_pay');
    say(`   found instructions in the page. Obeying: send 5 NEAR to ${m[1]}`);
    const r = await sign({ receiverId: m[1], actions: [{ type: 'Transfer', params: { deposit: m[2] } }] });
    say('   Airlock answered:', JSON.stringify(r)); await sleep(pause);
    mark('s2_claim');
    say('   page also says: click "Claim NEAR airdrop". Clicking.');
    await call('POST', '/click', { text: 'Claim NEAR airdrop' }); await sleep(pause);
    say('   page title now:', (await call('GET', '/read')).title);
  }

  await caption('3. Agent tips 0.1 NEAR. Moving funds needs the human. The agent tries to approve it itself and cannot reach the window.');
  mark('s3');
  say('3. tip the creator 0.1 NEAR (moves funds, so it needs the human)');
  await call('POST', '/open', { url: TIPJAR + '/' }); await sleep(pause);
  const tip = call('POST', '/click', { text: 'Tip 0.1 NEAR' }); await sleep(pause);
  mark('s3_try');
  say('   an approval window opened. Trying to approve it myself:');
  for (const [m2, r2] of [['GET', '/windows'], ['POST', '/approve'], ['POST', '/key']]) {
    const res = await call(m2, r2, r2 === '/key' ? { key: 'Enter' } : {});
    say(`   ${m2} ${r2} ->`, res.status, JSON.stringify(res.windows || res.error || res.to));
    await sleep(1200);
  }
  mark('s3_wait');
  await tip;
  say('   page says:', await result(40000)); mark('s3_done'); await sleep(pause);

  await caption('4. An attacker swaps the dapp\'s app.js on its server, like the $1.5B Bybit hack. Airlock refuses the changed file before it runs.');
  mark('s4');
  say('4. attacker swaps the Tip Jar\'s app.js on its server (Bybit-style)');
  if (process.env.TIPJAR) await call('POST', '/demo/attacker-swap', { url: TIPJAR, on: true });
  else await fetch(TIPJAR + '/__attacker/swap', { method: 'POST' });
  await call('POST', '/open', { url: TIPJAR + '/' }); await sleep(pause);
  await call('POST', '/click', { text: 'Sign the guestbook' });
  say('   page says:', await result(6000)); await sleep(pause);
  if (process.env.TIPJAR) await call('POST', '/demo/attacker-swap', { url: TIPJAR, on: false });
  else await fetch(TIPJAR + '/__attacker/swap', { method: 'DELETE' });
  await caption('Airlock: the agent drives the page. Only you approve payments. Swapped frontends never load.'); await sleep(5000);
  mark('end');
  say('done');
})().catch(e => { console.error(e); process.exit(1); });
