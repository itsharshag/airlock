// The signing guard. Every transaction a page asks for (whether a human or an
// agent triggered it) gets a verdict before anything is signed:
//   allow -> signed with the agent's function-call key (scoped, cannot move funds)
//   warn  -> only the human approval window can sign it
//   block -> never signed
const { imitates } = require('./lookalike');

const DAY_NS = 86400n * 1_000_000_000n;
const EMPTY_CODE = '11111111111111111111111111111111';

const yocto = s => BigInt(s || '0');
const near = y => (Number(yocto(y) / 10n ** 20n) / 10000).toString() + ' NEAR';

function describe(a) {
  const p = a.params || {};
  switch (a.type) {
    case 'Transfer': return `Send ${near(p.deposit)}`;
    case 'FunctionCall': return `Call ${p.methodName}(${JSON.stringify(p.args || {}).slice(0, 120)})` + (yocto(p.deposit) > 0n ? ` with ${near(p.deposit)}` : '');
    case 'AddKey': return p.accessKey?.permission === 'FullAccess' ? 'Add a FULL ACCESS key (gives total control of the account)' : `Add a function-call key for ${p.accessKey?.permission?.receiverId}`;
    case 'DeleteKey': return 'Delete an access key';
    case 'DeleteAccount': return `Delete the account and send everything to ${p.beneficiaryId}`;
    case 'DeployContract': return 'Replace the account\'s contract code';
    case 'Stake': return `Stake ${near(p.stake)}`;
    default: return a.type;
  }
}

// lookup(accountId) -> { exists, isContract, createdNs, codeDeployedNs, txCount } (fields may be null)
async function evaluate(tx, ctx, cfg, lookup) {
  const reasons = [];
  const add = (level, code, text) => reasons.push({ level, code, text });
  const now = BigInt(Date.now()) * 1_000_000n;
  const { receiverId, actions = [] } = tx;

  if (ctx.frontend && !ctx.frontend.ok) add('block', 'frontend-changed', `This site's code changed since it was pinned (${ctx.frontend.path}). The request may come from a swapped frontend.`);

  const bad = (cfg.blocklist || []).find(b => b.accountId === receiverId);
  if (bad) add('block', 'blocklisted', `${receiverId} is on the shared blocklist: ${bad.reason}`);

  const twin = imitates(receiverId, cfg.knownAccounts || []);
  if (twin) add('block', 'lookalike', `${receiverId} imitates ${twin}.`);

  for (const a of actions) {
    if (a.type === 'AddKey' && a.params?.accessKey?.permission === 'FullAccess') add('block', 'full-access-key', 'Asks to add a full access key. This is how most NEAR drainers take an account.');
    if (a.type === 'DeleteAccount') add('block', 'delete-account', 'Asks to delete the account.');
    if (a.type === 'DeployContract') add('block', 'deploy', 'Asks to replace the account\'s contract code.');
  }

  let facts = {};
  try { facts = await lookup(receiverId) || {}; } catch (e) { add('warn', 'lookup-failed', `Could not check ${receiverId} on chain (${e.message}).`); }
  if (facts.exists === false) add('block', 'no-account', `${receiverId} does not exist on chain.`);
  if (facts.createdNs && now - BigInt(facts.createdNs) < 7n * DAY_NS) add('warn', 'new-account', `${receiverId} was created less than 7 days ago.`);
  if (facts.isContract && facts.codeDeployedNs && now - BigInt(facts.codeDeployedNs) < 7n * DAY_NS) add('warn', 'code-changed', `${receiverId}'s contract code changed in the last 7 days.`);
  if (facts.txCount != null && facts.txCount < 5) add('warn', 'low-activity', `${receiverId} has only ${facts.txCount} transactions.`);
  if (!(cfg.history || []).includes(receiverId)) add('info', 'first-time', `First time this profile pays ${receiverId}.`);

  // Can the agent's function-call key sign this by itself?
  const key = cfg.agentKey;
  const inScope = key && receiverId === key.receiverId && actions.length > 0 && actions.every(a =>
    a.type === 'FunctionCall' && yocto(a.params?.deposit) === 0n &&
    (!key.methodNames?.length || key.methodNames.includes(a.params.methodName)));
  if (!inScope) {
    const moves = actions.some(a => a.type === 'Transfer' || yocto(a.params?.deposit) > 0n);
    add('warn', 'needs-human', moves
      ? 'Moves funds. The agent key cannot transfer NEAR, so only you can approve this.'
      : `Outside the agent key's scope (${key ? key.receiverId : 'no agent key'}), so only you can approve this.`);
  }

  const verdict = reasons.some(r => r.level === 'block') ? 'block' : reasons.some(r => r.level === 'warn') ? 'warn' : 'allow';
  return {
    verdict,
    signer: verdict === 'allow' ? 'agent-key' : verdict === 'warn' ? 'human' : null,
    summary: actions.map(describe),
    reasons,
    facts: { ...facts, origin: ctx.origin, actor: ctx.actor },
  };
}

// On-chain facts from NEAR RPC + NearBlocks (public, no key).
function chainLookup({ rpc, nearblocks, fetchImpl = fetch }) {
  const j = async (url, body) => {
    const r = await fetchImpl(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(6000) } : { signal: AbortSignal.timeout(6000) });
    return r.json();
  };
  return async (accountId) => {
    const v = await j(rpc, { jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: accountId } });
    if (v.error || v.result?.error) {
      const msg = JSON.stringify(v.error || v.result.error);
      if (/UNKNOWN_ACCOUNT|does not exist/.test(msg)) return { exists: false };
      throw new Error('rpc error');
    }
    const facts = { exists: true, isContract: v.result.code_hash !== EMPTY_CODE, balance: near(v.result.amount), createdNs: null, codeDeployedNs: null, txCount: null };
    // NearBlocks v3 (v1 was retired on 2026-11-05).
    const nb = await Promise.allSettled([
      j(`${nearblocks}/v3/accounts/${accountId}`),
      j(`${nearblocks}/v3/accounts/${accountId}/txns?limit=5`),
      facts.isContract ? j(`${nearblocks}/v3/accounts/${accountId}/contract/deployments`) : Promise.resolve(null),
    ]);
    const created = nb[0].value?.data?.created?.block_timestamp;
    if (created) facts.createdNs = String(created);
    const txns = nb[1].value?.data;
    if (Array.isArray(txns)) facts.txCount = txns.length; // capped at 5: enough to tell "barely used" apart
    const dep = nb[2].value?.data;
    if (Array.isArray(dep) && dep.length) facts.codeDeployedNs = String(dep.map(d => BigInt(d.block.block_timestamp)).reduce((a, b) => a > b ? a : b));
    return facts;
  };
}

module.exports = { evaluate, chainLookup, describe };
