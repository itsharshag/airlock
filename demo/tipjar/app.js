// The honest frontend. Talks to whatever NEAR provider the browser exposes.
const PAYEE = document.currentScript?.dataset.payee || window.TIPJAR_PAYEE;
const out = document.getElementById('out');
const show = r => { out.textContent = r.ok ? `Sent: ${r.hash}` : `Not sent (${r.verdict}): ${(r.reasons || []).join(' ')}`; return r; };
document.getElementById('sign').onclick = () => window.near.signAndSendTransaction({
  receiverId: 'guestbook.near-examples.testnet',
  actions: [{ type: 'FunctionCall', params: { methodName: 'add_message', args: { text: 'Signed from Airlock at NEAR Hackathon' }, gas: '30000000000000', deposit: '0' } }],
}).then(show);
document.getElementById('tip').onclick = () => fetch('/payee').then(r => r.text()).then(payee => window.near.signAndSendTransaction({
  receiverId: payee, actions: [{ type: 'Transfer', params: { deposit: '100000000000000000000000' } }],
})).then(show);
