# Fluvio — Real-Time Money Streaming on Initia

> Stream INIT token by the millisecond. Salaries, subscriptions, grants — paid continuously, on-chain, trustless.

- Website: https://fluviio.vercel.app
- Live App: https://sands786.github.io/fluvio/
- Contract: init17g5nnyjfkhnjg4w2m82m9st6lxdhuw62zjgsmd
- Deploy TX: https://scan.testnet.initia.xyz/initiation-2/txs/21D7D1326DA445B2AE9843FC2DE05B9F9BD457FF760EB7BD55E5DAA07106CE64
- Network: Initia Testnet (initiation-2)

---

## What is Fluvio?

Fluvio is the first native money streaming protocol built on Initia. Instead of sending a lump-sum payment, you open a stream and the recipient earns token continuously, every 100 milliseconds, directly on-chain.

Unlike Superfluid on Ethereum which fakes streaming with JavaScript math, Fluvio updates real on-chain state every 100ms — because Initia actually produces a block every 100ms.

---

## Why Initia?

Initia's 100ms block time makes Fluvio uniquely powerful:

- Real on-chain state — claimable balance is always accurate, every block
- Interwoven ecosystem — stream INIT across any Minitia via OPinit bridge
- Move VM — safe, auditable escrow logic with resource-based ownership
- .init usernames — send streams to human-readable addresses

---

## Features

### Real-Time Streaming
Open a stream with any amount and duration. The recipient claimable balance increases every 100 milliseconds — visibly in the UI with an animated glowing progress bar.

### Session Keys
Enable a session key once with a single Keplr signature. After that, stream operations execute automatically without wallet popups.

### Interwoven Bridge
Move INIT between Initia L1 and Minitias via the native OPinit bridge — all from inside Fluvio.

### Live Dashboard
- Claimable balance ticking up every 100ms in real time
- Animated glowing progress bar showing stream completion
- INIT/sec rate on every stream card
- Time remaining for each active stream
- Auto-refreshing wallet balance after transactions
- Global flow rate across all on-chain streams

---

## Smart Contracts

Three Move contracts handle the full streaming lifecycle:

| Contract | Role |
|---|---|
| stream_core | Stream creation, withdrawal, cancellation logic |
| stream_vault | Escrow — holds INIT securely until claimed |
| stream_registry | On-chain index and global stats oracle |

Contract address: init17g5nnyjfkhnjg4w2m82m9st6lxdhuw62zjgsmd
Deployed at block: 22041965

### Stream Lifecycle

create_stream(recipient, amount, duration, type, note)
  - Locks INIT in stream_vault
  - Registers stream in StreamRegistry
  - Starts flowing immediately at rate = amount / duration

withdraw(stream_id)
  - Calculates claimable = elapsed_ms x rate_per_ms
  - Transfers claimable INIT to recipient
  - Updates withdrawn_by_recipient on-chain

cancel_stream(stream_id)
  - Stops the stream immediately
  - Returns unstreamed INIT to sender
  - Recipient keeps what was already earned

---

## Stream Types

| Type | Use Case |
|---|---|
| Salary | Continuous employee compensation |
| Subscription | Pay-per-second SaaS or content access |
| Grant | Milestone-free funding that vests in real time |
| Rental | Time-based access payments |
| Custom | Any payment that benefits from continuity |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contracts | Move (Initia MoveVM) |
| Frontend | React + TypeScript + Vite |
| Wallet | Keplr + CosmJS |
| Chain | Initia Testnet (initiation-2) |
| Bridge | OPinit (native Initia bridge) |
| Deployment | GitHub Pages + GitHub Actions CI/CD |

---

## Running Locally

git clone https://github.com/sands786/fluvio
cd fluvio/frontend
npm install
npm run dev

Open http://localhost:5173, connect Keplr wallet, and start streaming.

---

## What Makes This Different

| Feature | Fluvio | Superfluid (ETH) | Sablier (ETH) |
|---|---|---|---|
| Real on-chain updates | YES every 100ms | NO JS math only | NO JS math only |
| Native Move VM | YES | NO | NO |
| Session keys | YES | NO | NO |
| Interwoven bridge | YES | NO | NO |
| Block time | 100ms | 12 seconds | 12 seconds |

---

## Hackathon Submission

Built for the Initia hackathon. Fluvio demonstrates:

1. Novel use of Initia 100ms block time — makes real streaming possible
2. Full Move contract suite — three contracts working together
3. Session key integration — Initia-native UX pattern
4. Interwoven bridge — cross-Minitia INIT movement
5. Production-quality UI — live ticking numbers, animated progress bars, real-time data

---

Fluvio — because money should flow, not move.
