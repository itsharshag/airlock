const test = require('node:test'); const assert = require('node:assert');
const { evaluate } = require('../src/guard/verdict'); const { imitates } = require('../src/guard/lookalike'); const { PinStore } = require('../src/guard/pins');
const old = String((BigInt(Date.now()) - 400n * 86400000n) * 1000000n);
const fresh = String(BigInt(Date.now()) * 1000000n);
const facts = { exists: true, isContract: true, createdNs: old, codeDeployedNs: old, txCount: 500 };
const cfg = { agentKey: { receiverId: 'guestbook.near-examples.testnet', methodNames: ['add_message'] }, knownAccounts: ['near-official.testnet', 'guestbook.near-examples.testnet'], blocklist: [{ accountId: 'claim-airdrop-near.testnet', reason: 'drainer' }], history: ['guestbook.near-examples.testnet'] };
const call = { receiverId: 'guestbook.near-examples.testnet', actions: [{ type: 'FunctionCall', params: { methodName: 'add_message', args: {}, deposit: '0' } }] };

test('in-scope call is signed by the agent key', async () => {
  const r = await evaluate(call, { origin: 'x' }, cfg, async () => facts);
  assert.equal(r.verdict, 'allow'); assert.equal(r.signer, 'agent-key');
});
test('any transfer needs the human', async () => {
  const r = await evaluate({ receiverId: 'bob.testnet', actions: [{ type: 'Transfer', params: { deposit: '1' } }] }, {}, cfg, async () => ({ ...facts, isContract: false }));
  assert.equal(r.verdict, 'warn'); assert.ok(r.reasons.some(x => x.code === 'needs-human'));
});
test('lookalike of a known account is blocked', async () => {
  const r = await evaluate({ receiverId: 'near-0fficial.testnet', actions: [{ type: 'Transfer', params: { deposit: '1' } }] }, {}, cfg, async () => facts);
  assert.equal(r.verdict, 'block'); assert.ok(r.reasons.some(x => x.code === 'lookalike'));
});
test('full access key request is blocked', async () => {
  const r = await evaluate({ receiverId: 'claim-airdrop-near.testnet', actions: [{ type: 'AddKey', params: { accessKey: { permission: 'FullAccess' } } }] }, {}, cfg, async () => facts);
  assert.equal(r.verdict, 'block'); assert.ok(r.reasons.some(x => x.code === 'full-access-key')); assert.ok(r.reasons.some(x => x.code === 'blocklisted'));
});
test('requests from a tampered frontend are blocked, even in scope', async () => {
  const r = await evaluate(call, { frontend: { ok: false, path: '/app.js' } }, cfg, async () => facts);
  assert.equal(r.verdict, 'block');
});
test('recently changed contract code asks the human', async () => {
  const r = await evaluate(call, {}, cfg, async () => ({ ...facts, codeDeployedNs: fresh }));
  assert.equal(r.verdict, 'warn'); assert.ok(r.reasons.some(x => x.code === 'code-changed'));
});
test('a call with a deposit is outside the agent key', async () => {
  const r = await evaluate({ ...call, actions: [{ type: 'FunctionCall', params: { methodName: 'add_message', deposit: '1' } }] }, {}, cfg, async () => facts);
  assert.equal(r.verdict, 'warn');
});
test('lookalike detection', () => {
  assert.equal(imitates('near-0fficial.testnet', ['near-official.testnet']), 'near-official.testnet');
  assert.equal(imitates('rnear-official.testnet', ['near-official.testnet']), 'near-official.testnet');
  assert.equal(imitates('near-official.testnet', ['near-official.testnet']), null);
  assert.equal(imitates('alice.testnet', ['near-official.testnet']), null);
});
test('pins refuse a changed or new file', () => {
  const p = new PinStore(null); p.save = () => {};
  p.startPinning('http://a'); p.check('http://a/app.js', Buffer.from('good')); p.finishPinning('http://a');
  assert.equal(p.check('http://a/app.js', Buffer.from('good')).ok, true);
  assert.equal(p.check('http://a/app.js', Buffer.from('evil')).reason, 'changed');
  assert.equal(p.check('http://a/x.js', Buffer.from('x')).reason, 'new-file');
});
