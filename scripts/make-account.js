// Creates a fresh testnet account through the public faucet and saves its
// full-access key to .keys/owner.json (gitignored).
const { KeyPair } = require('near-api-js');
const fs = require('fs');
(async () => {
  const id = 'airlock-' + Date.now().toString(36) + '.testnet';
  const kp = KeyPair.fromRandom('ed25519');
  const r = await fetch('https://helper.nearprotocol.com/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }) });
  if (!r.ok) throw new Error(await r.text());
  fs.mkdirSync('.keys', { recursive: true });
  fs.writeFileSync('.keys/owner.json', JSON.stringify({ accountId: id, secretKey: kp.toString(), publicKey: kp.getPublicKey().toString() }));
  console.log('created', id);
})().catch(e => { console.error(e); process.exit(1); });
