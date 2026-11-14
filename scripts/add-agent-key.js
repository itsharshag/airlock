// Adds the agent's function-call key: may only call add_message on the guestbook,
// with a 0.25 NEAR gas allowance. It cannot transfer NEAR or add keys.
const fs = require('fs');
const { KeyPair } = require('near-api-js');
const { makeSigner } = require('../src/signer');
(async () => {
  const owner = JSON.parse(fs.readFileSync('.keys/owner.json'));
  const scope = { receiverId: 'guestbook.near-examples.testnet', methodNames: ['add_message'], allowance: '250000000000000000000000' };
  const kp = KeyPair.fromRandom('ed25519');
  const s = await makeSigner({ networkId: 'testnet', ...owner });
  await s.account.addKey(kp.getPublicKey().toString(), scope.receiverId, scope.methodNames, BigInt(scope.allowance));
  fs.writeFileSync('.keys/agent.json', JSON.stringify({ accountId: owner.accountId, secretKey: kp.toString(), publicKey: kp.getPublicKey().toString(), ...scope }));
  console.log('agent key', kp.getPublicKey().toString(), '->', scope.receiverId, scope.methodNames);
})().catch(e => { console.error(e); process.exit(1); });
