// Two signers, both in the main process (never in a page):
//  - agent: a function-call access key scoped to one contract. NEAR itself
//    refuses anything else it tries: no transfers, no deposits, no new keys.
//  - owner: the full-access key, used only after the human approves in the
//    approval window.
const { connect, keyStores, KeyPair, transactions, utils } = require('near-api-js');

const NETWORKS = {
  testnet: { nodeUrl: 'https://rpc.testnet.near.org', nearblocks: 'https://api-testnet.nearblocks.io', explorer: 'https://testnet.nearblocks.io/txns/' },
  mainnet: { nodeUrl: 'https://rpc.mainnet.near.org', nearblocks: 'https://api.nearblocks.io', explorer: 'https://nearblocks.io/txns/' },
};

function toAction(a) {
  const p = a.params || {};
  switch (a.type) {
    case 'Transfer': return transactions.transfer(BigInt(p.deposit));
    case 'FunctionCall': return transactions.functionCall(p.methodName, Buffer.from(JSON.stringify(p.args || {})), BigInt(p.gas || '30000000000000'), BigInt(p.deposit || '0'));
    default: throw new Error(`Airlock does not sign ${a.type} actions`);
  }
}

async function makeSigner({ networkId, accountId, secretKey }) {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(networkId, accountId, KeyPair.fromString(secretKey));
  const near = await connect({ networkId, nodeUrl: NETWORKS[networkId].nodeUrl, keyStore });
  const account = await near.account(accountId);
  return {
    accountId,
    async send(tx) {
      const res = await account.signAndSendTransaction({ receiverId: tx.receiverId, actions: tx.actions.map(toAction) });
      return { hash: res.transaction.hash, status: res.status };
    },
    account,
  };
}

module.exports = { makeSigner, NETWORKS, toAction, utils };
