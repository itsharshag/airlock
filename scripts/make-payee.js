// Creates a second testnet account to receive the human-approved tip.
const { KeyPair } = require('near-api-js');
const fs = require('fs');
(async () => {
  const id = 'airlock-tipjar-' + Date.now().toString(36) + '.testnet';
  const kp = KeyPair.fromRandom('ed25519');
  const r = await fetch('https://helper.nearprotocol.com/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }) });
  if (!r.ok) throw new Error(await r.text());
  fs.mkdirSync('.keys', { recursive: true });
  fs.writeFileSync('.keys/payee.json', JSON.stringify({ accountId: id, secretKey: kp.toString() }));
  console.log(id);
})().catch(e => { console.error(e); process.exit(1); });
