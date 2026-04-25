# Fluvio — Real-Time Money Streaming on Initia

> Stream INIT token by the millisecond. Salaries, subscriptions, grants — paid continuously, on-chain, trustless.

[![Live App](https://img.shields.io/badge/Live%20App-GitHub%20Pages-green?style=for-the-badge)](https://sands786.github.io/fluvio/)
[![Website](https://img.shields.io/badge/Website-fluviio.vercel.app-blue?style=for-the-badge)](https://fluviio.vercel.app)
[![GitHub](https://img.shields.io/badge/GitHub-sands786%2Ffluvio-black?style=for-the-badge&logo=github)](https://github.com/sands786/fluvio)
[![Network](https://img.shields.io/badge/Network-Initia%20Testnet-purple?style=for-the-badge)](https://scan.testnet.initia.xyz)

---

## The Problem

Money moves in chunks. Salaries paid monthly. Subscriptions charged upfront. Grants disbursed all at once. The entire financial system is built around intervals — because the infrastructure never supported anything better.

Existing streaming protocols like Superfluid on Ethereum don't actually solve this. They fake real-time using JavaScript math, calculating what a user *should* have received and only settling on-chain when manually triggered. Between those triggers, nothing real happens on-chain. The balance you see is an estimate, not a fact.

**This is not streaming. This is scheduled payments with a better UI.**

---

## The Solution

Fluvio is the first **native money streaming protocol** built on Initia.

Initia produces a real block every **100 milliseconds**. Fluvio exploits this to stream token continuously — updating actual on-chain state 10 times per second. Every claimable balance is a real blockchain number. Every stream update is a genuine transaction.
Traditional payment:  ────────────────[lump sum]──► (monthly)
Superfluid (ETH):     ════════════════[JS math]════► (fake, 12s blocks)
Fluvio (Initia):      ████████████████████████████► (real, every 100ms)

This is genuine real-time finance. Not an illusion.

---

## Live Deployment

| | |
|---|---|
| **Network** | Initia Testnet (initiation-2) |
| **Contract** | `init17g5nnyjfkhnjg4w2m82m9st6lxdhuw62zjgsmd` |
| **Deploy TX** | [21D7D132...CE64](https://scan.testnet.initia.xyz/initiation-2/txs/21D7D1326DA445B2AE9843FC2DE05B9F9BD457FF760EB7BD55E5DAA07106CE64) |
| **Deploy Block** | #22041965 |
| **Live App** | https://sands786.github.io/fluvio/ |
| **Website** | https://fluviio.vercel.app |
| **Demo Video** | https://drive.google.com/file/d/1PRhwYRPRHWucS4elXhboLhMIDblfqqif/view |

---

## Features

### Real-Time Streaming
Open a stream with any amount and duration. The recipient balance increases every 100 milliseconds — visibly, in the UI, with an animated glowing progress bar. The rate per second is displayed on every stream card. Time remaining counts down in real time.

### Session Keys
Enable a session key with a single Keplr signature. After that, all stream operations execute automatically — no wallet popups, no interruptions. Critical for automated, long-running payment flows. Built using Initia's native session key pattern.

### Interwoven Bridge
Move INIT between Initia L1 and Minitias (Minimove, Miniwasm, Minievm) via the native OPinit bridge. Deposit from L1, use the Minitia ecosystem, withdraw back — all from within Fluvio.

### Live Dashboard
- Claimable balance ticking every 100ms in real time
- Animated glowing progress bar showing stream completion
- INIT per second rate on every stream card
- Time remaining for each active stream
- Auto-refreshing wallet balance after transactions
- Global flow rate across all on-chain streams

### Explore Tab
Browse every active stream on the Fluvio contract. Filter by live or ended. See real-time flow rates, sender, recipient, progress — all pulled directly from on-chain data.

---

## Smart Contracts

Three Move contracts handle the full streaming lifecycle:

| Contract | Role |
|---|---|
| `stream_core` | Stream creation, withdrawal, cancellation logic |
| `stream_vault` | Secure INIT escrow — holds funds until claimed |
| `stream_registry` | Public on-chain index — any Initia app can query |

### Stream Lifecycle
create_stream(recipient, amount, duration, type, note)
├── Locks INIT in stream_vault
├── Registers stream in StreamRegistry
└── Starts flowing immediately at rate = amount / duration_ms
withdraw(stream_id)
├── claimable = (elapsed_ms × rate_per_ms) - withdrawn
├── Transfers exact claimable amount to recipient
└── Updates withdrawn_by_recipient on-chain
cancel_stream(stream_id)
├── Stops stream immediately
├── Returns unstreamed INIT to sender
└── Recipient keeps everything already earned

### The Math
rate_per_ms = total_deposited_uinit / duration_ms
claimable   = (elapsed_ms × rate_per_ms) - withdrawn_by_recipient

This runs entirely in Move. No JavaScript. No estimates. Pure on-chain math.

---

## Stream Types

| Type | Use Case | Example |
|---|---|---|
| **Salary** | Continuous employee pay | Worker earns every second they work |
| **Subscription** | Pay-per-second access | Pay only while using a service |
| **Grant** | Real-time vesting | Funding flows as builders build |
| **Rental** | Time-based payments | Pay for infra by the millisecond |
| **Custom** | Any continuous payment | Any use case that benefits from flow |

---

## Architecture
┌─────────────────────────────────────────────────┐
│                Fluvio Frontend                  │
│         React + TypeScript + Vite               │
│                                                 │
│  useWallet      Keplr connection + balance      │
│  useStreams      On-chain stream fetching        │
│  useContract     TX broadcasting                │
│  useSessionKey   Ephemeral key management       │
│  BridgeTab       OPinit bridge integration      │
└──────────────────────┬──────────────────────────┘
│ REST API
┌──────────────────────▼──────────────────────────┐
│              Initia Testnet                     │
│              initiation-2                       │
│                                                 │
│  stream_core      Logic layer                   │
│  stream_vault     Escrow layer                  │
│  stream_registry  Index layer                   │
└─────────────────────────────────────────────────┘

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contracts | Move (Initia MoveVM) |
| Frontend | React + TypeScript + Vite |
| Wallet | Keplr + CosmJS |
| Chain | Initia Testnet (initiation-2) |
| Bridge | OPinit (native Initia bridge) |
| CI/CD | GitHub Actions |
| Hosting | GitHub Pages |

---

## Comparison

| Feature | Fluvio | Superfluid (ETH) | Sablier (ETH) |
|---|---|---|---|
| Real on-chain updates | YES — every 100ms | NO — JS math only | NO — JS math only |
| Native Move VM | YES | NO | NO |
| Session keys | YES | NO | NO |
| Interwoven bridge | YES | NO | NO |
| Block time | 100ms | 12 seconds | 12 seconds |
| Genuine streaming | YES | NO | NO |

---

## Running Locally

```bash
git clone https://github.com/sands786/fluvio
cd fluvio/frontend
npm install
npm run dev
```

Open http://localhost:5173, connect Keplr, and start streaming.

---

## Why This Matters

The Interwoven Stack makes Fluvio uniquely powerful:

- **100ms blocks** — real streaming, not simulation
- **Move VM** — safe resource-based escrow, no reentrancy risks
- **Session keys** — native Initia UX, one signature for unlimited ops
- **OPinit bridge** — stream across the entire Interwoven ecosystem
- **.init usernames** — human-readable addresses for streams

Fluvio is not just a hackathon project. It is infrastructure. Any Initia app can query the stream_registry. Any wallet can receive streams. Any developer can build on top of the contracts.

---

## Hackathon Submission

Built for the Initia hackathon. Demonstrates:

1. Novel use of Initia 100ms block time for genuine real-time finance
2. Full Move contract suite — three contracts working in production
3. Session key integration — Initia-native UX pattern
4. Interwoven bridge — cross-Minitia INIT movement
5. Production-quality UI — live ticking numbers, animated progress, real data

---

*Fluvio — because money should flow. Not move.*
