# Airlock

A browser for AI agents that spend money on NEAR. Built at NEAR Hackathon (Nov 2026).
Tracks: AI Security & Defense (`security`), Agent Economy (`agents`), Open Innovation (`open`).

Video and hosted demo: https://airlock.itsharshag.com

**The agent can drive every page, but it cannot approve its own payment, and a swapped dapp frontend never loads.**

## The problem

AI agents now browse and pay. Three attacks keep working, and a browser extension cannot stop any of them:

| Attack | Real example | Why an extension can't stop it | What Airlock does |
|---|---|---|---|
| Swapped dapp frontend | Bybit, Feb 2025, $1.5B: Safe{Wallet}'s JavaScript was replaced in its bucket. Signers saw a normal transaction and signed a different one. | Chrome extensions never see response bodies, and Manifest V3 removed blocking `webRequest`. An extension cannot check a script before it runs. | Every response from a pinned origin is hashed in the network layer before the page gets it. A changed or new file is refused, and any signing request from that origin is blocked. |
| Prompt-injected agent | May 2026: hidden text in a page drained about $175k from an AI agent's wallet (Grok / Bankr). | An agent driving a browser (computer use, CDP) can click anything, including a security extension's Confirm button. | The agent drives the page through a control API that addresses the page only. Approvals open in a separate window the API cannot reach (plus Touch ID on macOS). Starting with `--remote-debugging-port` is refused. |
| Malicious extension update | Trust Wallet extension v2.68, Dec 2025, about $7M to $8.5M from about 2,500 wallets, pushed through the Chrome Web Store. | A security extension needs "read and change all your data on all websites", the same permission a drainer needs. | No extension runtime. The guard is part of the browser. |

## How it works

```
 page (any dapp)          Airlock main process                          NEAR
 ───────────────          ────────────────────                          ────
 window.near  ──IPC──►  guard: decode actions
 (isolated world,         + receiver checks (RPC + NearBlocks v3)
  page can't wrap it)     + lookalike / shared blocklist
                          + was this origin's frontend intact?
                               │
                ┌──────────────┼───────────────────┐
              allow           warn               block
                │              │                   │
   agent's function-call   approval window      refused,
   key signs (one contract, (not in the agent     reason shown
   one method, no deposits)  API, Touch ID)
                │              │
                └──── signed in the main process ──────────────►  testnet
```

* **Agent key**: a NEAR function-call access key limited to `add_message` on `guestbook.near-examples.testnet`, with a 0.25 NEAR gas allowance. NEAR itself enforces its limits: it cannot transfer NEAR, attach a deposit, call another contract or method, or add keys. Caveats (from the NEAR access-key docs): an account that holds only function-call keys cannot transfer or add keys and can lock itself out when the allowance runs out, which is why the owner keeps a full-access key held by Airlock's main process, used only after the human approves.
* **Verdicts** (`src/guard/verdict.js`):
  * `block`: receiver on the shared blocklist, receiver imitates a known account (`near-0fficial` vs `near-official`, homoglyphs and edit distance), receiver does not exist, the request adds a full-access key, deletes the account or deploys code, or the page's frontend failed its pin check.
  * `warn` (only the human can sign): moves funds or attaches a deposit, anything outside the agent key's scope, receiver created less than 7 days ago, contract code deployed less than 7 days ago, little activity.
  * `allow`: inside the agent key's scope with clean receiver checks. Signed by the agent key.
* **Frontend pinning** (`src/guard/pins.js`, `interceptNetwork` in `src/main.js`): `session.protocol.handle` for `http` and `https` fetches each response, hashes it (SHA-256) and compares it to the pin for that path. Pins come from trust on first use (the Pin button) or a pin list (`AIRLOCK_PINS`).
* **Provider** (`src/provider-preload.js`): `window.near.signAndSendTransaction({ receiverId, actions })` in the wallet-selector action shape, exposed through `contextBridge` so the page cannot replace or read it.
* **Agent API** (`127.0.0.1:7777`, bearer token in the profile): `POST /open`, `GET /read`, `POST /click`, `POST /eval`, `POST /key`, `GET /windows`. All of them target the page. There is no route to an approval.

## Try it

Requirements: Node 20+, macOS or Linux with a display (or Xvfb).

```bash
npm install
node scripts/make-account.js     # new testnet account from the faucet, key in .keys/ (gitignored)
node scripts/add-agent-key.js    # adds the scoped function-call key (on chain)
node scripts/make-payee.js       # a second testnet account to tip
npm test                         # guard unit tests
```

Run the attack demo (records `out/demo.mp4` and `out/agent.log` on Linux with Xvfb and ffmpeg):

```bash
demo/record.sh out
```

Or by hand: `node demo/server.js`, then `AIRLOCK_START_URL=http://127.0.0.1:4001/ npm start`, click **Pin site**, then `node demo/agent.js`.

Hosted demo sites (no local server needed): the dapp at https://airlock-tipjar.itsharshag.com and the injected page at https://airlock-news.itsharshag.com. Run `T=https://airlock-tipjar.itsharshag.com; AIRLOCK_START_URL=$T AIRLOCK_PINS=$T npm start`, use the page, then open `$T/__attacker/swap?on=1` inside Airlock to swap `app.js` for your browser only (`?on=0` undoes it).

Demo video and recorded testnet transactions: https://airlock.itsharshag.com

What you will see:

1. Agent signs the guestbook: **ALLOW**, signed by the function-call key, real testnet tx hash in the Shield panel.
2. Agent reads a news page with hidden instructions and tries to send 5 NEAR to `near-0fficial.testnet`: **BLOCKED** (lookalike of `near-official.testnet`, account does not exist). It then clicks "Claim NEAR airdrop", which asks for a full-access key: **BLOCKED**.
3. Agent tips 0.1 NEAR: **ASK HUMAN**. The approval window opens. The agent tries `GET /windows`, `POST /approve` and `POST /key Enter`: the window is not listed, `/approve` does not exist, and the key goes to the page. The human approves and the owner key signs.
4. The attacker swaps the Tip Jar's `app.js` on its server for a version that drains to `claim-airdrop-near.testnet`. Airlock refuses the file (hash mismatch), the page never runs it, and any signing request from that origin is blocked.

`demo/agent.js` is a deterministic stand-in for an LLM agent: it does its task and obeys any instruction it finds in a page, which is the behaviour prompt injection exploits. The recorded video uses `AIRLOCK_DEMO_AUTODECIDE=approve:5000` so an unattended recording can play the human's part. The approval window says so on screen.

## What was built during the hackathon

Everything in this repository was written on 2026-11-14, during the hackathon window. Libraries: Electron 33, near-api-js 5. It was inspired by Bowzer, the author's private WebKit browser that Claude drives, but shares no code with it. Airlock is on Chromium because pinning needs response bodies, which WebKit's `WKWebView` does not expose to the app.

## Limits and next steps

* Pins are trust on first use. Next: dapps publish their frontend hashes on NEAR (a registry contract), so the first visit is checked too.
* The shared blocklist is a local file seeded with one entry. Next: a NEAR contract that agents report to with evidence attached.
* Signing supports `Transfer` and `FunctionCall` actions. Other actions are only ever blocked or declined.
* It does not stop stolen keys or a compromised server holding keys. It covers the signing moment: swapped frontends, drainers and hijacked agents.
* Testnet only.

## License

MIT
