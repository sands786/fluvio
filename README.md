# Fluvio — Real-Time Money Streaming on Initia

> *"Superfluid fakes streaming with JavaScript math. We actually stream."*

**Money flows, not moves.**

Fluvio is a real-time money streaming protocol built on a dedicated Initia appchain (`fluvio-1`). Instead of sending 1000 INIT in a single transaction, you stream 0.00116 INIT every second — continuously, for 10 days. The recipient's balance grows every 100ms, mirroring Initia's block time.

---

## Why This Only Works on Initia

| | Superfluid (Ethereum) | Fluvio (Initia) |
|---|---|---|
| Block time | 12 seconds | **100ms** |
| "Streaming" reality | JS math pretending to be on-chain | **Real on-chain state every 100ms** |
| Stream creation gas | $5–20 | **Fractions of a cent** |
| Wallet friction | Popup for every interaction | **Sign once with Session Keys** |
| Identity | 0x hex addresses | **`alice.init` usernames** |
| Cross-chain deposits | Manual bridging | **Interwoven Bridge native** |
| Buffer/liquidation system | Complex sentinel bots required | **Minimal — fast finality = fast detection** |

**The core insight:** `timestamp::now_milliseconds()` on Initia advances every 100ms. Our `calculate_claimable()` function uses this to produce genuinely continuous financial flows. On Ethereum, the same math produces updates every 12 seconds — that's not streaming, that's batching with a nice UI.

---

## Initia Native Features Used

### 1. Auto-signing / Session UX
Users grant a session key scoped to `create_stream` and `withdraw` actions with a configurable max spend limit. After that single signature, streams run automatically for their entire duration — days, weeks, or months — without a single wallet popup.

### 2. .init Usernames
Streams use human-readable `.init` usernames as identities. `shahmeer.init` sends a salary stream to `alice.init`. No hex addresses in the UI ever.

### 3. Interwoven Bridge
Users can deposit USDC from Ethereum, Arbitrum, or Solana. The Interwoven Bridge routes funds to `fluvio-1` automatically. Recipients can bridge earnings back to any chain. Cross-chain in one click.

---

## Smart Contracts

### `stream_vault.move`
Per-user escrow vault. Holds deposited INIT. Tracks free vs locked balance. Prevents double-spending across multiple active streams.

### `stream_core.move`
The streaming logic. Key function:

```move
fun calculate_claimable(stream: &Stream): u64 {
    let now = timestamp::now_milliseconds();  // 100ms resolution
    let elapsed = min(now, stream.end_time_ms) - stream.start_time_ms;
    let total_earned = elapsed * stream.rate_per_ms;
    let capped = min(total_earned, stream.total_deposited);
    if (capped > stream.withdrawn_by_recipient) {
        capped - stream.withdrawn_by_recipient
    } else { 0 }
}
```

No oracles. No off-chain computation. Pure deterministic math using Initia's millisecond timestamps.

### `stream_registry.move`
Public stats oracle. Any Initia app can query:
- Total active streams
- Global INIT flow rate per second
- All-time value streamed

---

## Architecture

```
User (any chain)
    │
    ▼
Interwoven Bridge ──► fluvio-1 appchain
    │                       │
    ▼                       ▼
stream_vault.move    stream_core.move
(escrow)             (rate calculations)
    │                       │
    └───────────────────────┤
                            ▼
                   stream_registry.move
                   (public stats oracle)
                            │
                            ▼
                   React Frontend
                   (100ms counter UI)
                   InterwovenKit session keys
                   .init username resolution
```

---

## Use Cases

| Use Case | Who benefits | Rate example |
|---|---|---|
| **Payroll** | DAOs, remote teams | 5000 INIT/month = 0.0019 INIT/sec |
| **Subscriptions** | Creators, SaaS | 100 INIT/month = 0.000038 INIT/sec |
| **Rentals** | Server time, assets | Custom rate per hour |
| **Grants** | Protocol contributors | Vested over 12 months |

---

## Revenue Model

The `fluvio-1` appchain captures **0.1% fee** on all streamed value. Every stream transaction generates appchain revenue — no external validators, no gas leaked to other chains.

- 1,000 active streams × 100 INIT/month average = 100,000 INIT/month streamed
- Platform fee: 100 INIT/month
- Scales linearly. Zero additional infrastructure cost.

---

## Deployment

```bash
# Deploy appchain
initiad init fluvio-1 --chain-id fluvio-1

# Deploy contracts
initiad tx move publish ./contracts \
  --from deployer \
  --chain-id fluvio-1 \
  --gas auto

# Verify
initiad query move view \
  --address 0x1234 \
  --module-name stream_core \
  --function-name get_total_streams
```

**Chain ID:** `fluvio-1`  
**Contract:** `0x1234` (replace after deployment)  
**Frontend:** https://fluvio.vercel.app

---

## Demo

1. Connect with `.init` username via InterwovenKit
2. Watch incoming salary stream: `initia-labs.init → shahmeer.init` — counter ticking every 100ms
3. Create a new stream to `alice.init` — sign once with session key
4. Watch both streams running simultaneously
5. Withdraw claimable amount — no wallet popup (session key handles it)
6. View global ecosystem stats in the Explore tab

**Demo line for judges:** *"Ethereum updates balances every 12 seconds. Watch this counter update every 100 milliseconds — because Initia produces blocks that fast. This isn't a UI trick. The on-chain state actually changes that frequently."*

---

## Team

Built for INITIATE: The Initia Hackathon (Season 1)  
Track: DeFi  
GitHub: https://github.com/sands786/fluvio

---

## License

MIT
# Sat Apr 25 01:39:41 PKT 2026
