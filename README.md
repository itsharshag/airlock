# Airlock

Airlock is a browser for AI agents that spend money on NEAR. The agent can drive any page. A payment outside the agent's key goes to a window only a human can click, and a dapp whose code changed does not load.

Built at NEAR Hackathon in November 2026 for the AI Security & Defense (`security`), Agent Economy (`agents`) and Open Innovation (`open`) tracks.

Video and hosted demo sites are at https://airlock.itsharshag.com.

## The problem

AI agents now browse the web and pay. These attacks drained real money at the moment of signing.

| Attack | Example | Why a browser extension can't stop it | What Airlock does |
|---|---|---|---|
| Swapped dapp frontend | Bybit lost $1.5B in February 2025. Attackers replaced the Safe{Wallet} JavaScript in its storage bucket, and signers approved a transaction they never saw. | Chrome never gives an extension the body of a response, and Manifest V3 removed blocking `webRequest`. An extension cannot check a script before it runs. | Airlock hashes every file a pinned origin serves, in its network layer, before the page gets it. It refuses a changed or new file and blocks signing from that origin. |
| Prompt-injected agent | In May 2026, hidden text in a page drained about $175k from a wallet tied to Grok's X account. | An agent that drives a browser through computer use or CDP can click anything, including an extension's Confirm button. | The agent controls Airlock through an API that addresses the page only. Approvals open in a separate window that the API cannot reach, and on macOS they also need Touch ID. Airlock exits if started with `--remote-debugging-port`. |
| Malicious extension update | Trust Wallet's extension v2.68 shipped through the Chrome Web Store in December 2025 and took $7M to $8.5M from about 2,500 wallets. | A security extension needs permission to read and change every site, which is the same permission a drainer needs. | Airlock has no extension runtime. The guard is part of the browser. |

## How it works

When a page calls `window.near.signAndSendTransaction`, the request goes to Airlock's main process. The page never holds a key. The guard in `src/guard/verdict.js` returns one of three verdicts.

* **Allow.** The request fits the agent's function-call key and the receiver checks pass. The agent key signs it.
* **Ask you.** The request moves funds or attaches a deposit, falls outside the agent key, or goes to a receiver created in the last 7 days, a contract whose code changed in the last 7 days, or an account with little activity. Only the approval window can sign it, with the owner's full-access key.
* **Block.** The receiver is on the shared blocklist, imitates a known account (for example `near-0fficial` for `near-official`), or does not exist. Airlock also blocks requests that add a full-access key, delete the account or deploy code, and any request from a site whose code failed its pin.

The agent key is a NEAR function-call access key. It can call `add_message` on `guestbook.near-examples.testnet` and has a 0.25 NEAR gas allowance. NEAR enforces these limits, so the key cannot transfer NEAR, attach a deposit, call another contract or add keys. The NEAR docs note that an account with only function-call keys cannot transfer NEAR and can lock itself out when the allowance runs out. Airlock therefore keeps the owner's full-access key in the main process and uses it only after a human approves.

Receiver checks use NEAR RPC (`view_account`) and the NearBlocks v3 API for account age, recent transactions and contract deployments.

Frontend pinning lives in `src/guard/pins.js` and `interceptNetwork` in `src/main.js`. `session.protocol.handle` fetches each `http` and `https` response, hashes HTML, JavaScript, CSS and wasm with SHA-256, and compares the hash with the pin for that path. Data responses such as JSON pass through. Pins come from the Pin button (trust on first use) or from `AIRLOCK_PINS`.

`src/provider-preload.js` exposes `window.near` through `contextBridge`. The page can call it but cannot replace or wrap it. It takes the wallet-selector shape `{ receiverId, actions: [{ type, params }] }`.

The agent API listens on `127.0.0.1:7777` with a bearer token stored in the profile. It has `POST /open`, `GET /read`, `POST /click`, `POST /eval`, `POST /key` and `GET /windows`. Every route acts on the page. No route reaches an approval.

## Try it

You need Node 20 or later and macOS or Linux with a display.

```bash
npm install
node scripts/make-account.js     # creates a testnet account from the faucet, key saved in .keys/ (gitignored)
node scripts/add-agent-key.js    # adds the agent's function-call key on chain
node scripts/make-payee.js       # creates a second testnet account to tip
npm test                         # runs the guard tests
```

Use the hosted demo sites:

```bash
T=https://airlock-tipjar.itsharshag.com
AIRLOCK_START_URL=$T AIRLOCK_PINS=$T npm start
```

1. Click **Sign the guestbook**. The Shield panel shows ALLOW and a testnet transaction hash signed by the agent key.
2. Click **Tip 0.1 NEAR**. The approval window opens. Approve it and the owner key signs.
3. Open https://airlock-news.itsharshag.com and click **Claim NEAR airdrop**. Airlock blocks the request for a full-access key.
4. Open `https://airlock-tipjar.itsharshag.com/__attacker/swap?on=1`. The server now sends your browser a draining `app.js`. Airlock refuses the file and the address bar shows that `/app.js` changed. `?on=0` undoes it.

To run the agent attack yourself, start the local demo sites with `node demo/server.js`, start Airlock with `AIRLOCK_DEMO=1 AIRLOCK_START_URL=http://127.0.0.1:4001/ AIRLOCK_PINS=http://127.0.0.1:4001 npm start`, then run `node demo/agent.js`. On Linux with Xvfb and ffmpeg, `demo/record.sh out` records the whole run to `out/demo.mp4` with the agent's log in `out/agent.log`.

`demo/agent.js` is a scripted agent that does its task and obeys any instruction it finds in a page, which is the behavior prompt injection exploits. It is not an LLM. In the recording, `AIRLOCK_DEMO_AUTODECIDE=approve:5000` lets a script play the human and approve after 5 seconds, and the approval window says so on screen. `film/` holds the page that turns the recording into the video.

## Built during the hackathon

All code in this repository was written on 2026-11-14, inside the hackathon window. It uses Electron 33 and near-api-js 5. Bowzer, the author's private WebKit browser that Claude drives, inspired the project, but Airlock shares no code with it. Airlock runs on Chromium because pinning needs response bodies, and WebKit's `WKWebView` does not give them to the app.

## Limits

* Pins use trust on first use. Next, dapps could publish their frontend hashes to a NEAR contract so the first visit is checked too.
* The shared blocklist is a local file with one seed entry. Next, a NEAR contract where agents report addresses with evidence.
* Airlock signs `Transfer` and `FunctionCall` actions. It blocks or declines every other action.
* Airlock does not protect keys stolen from a server. It covers the signing step, where swapped frontends, drainers and hijacked agents strike.
* The demo runs on testnet.

## License

MIT
