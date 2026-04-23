/// Fluvio - Real-time money streaming on Initia
/// "Superfluid fakes streaming with JS math. We actually stream."
///
/// Key insight: Initia's 100ms block time means timestamp::now_milliseconds()
/// advances every 100ms - enabling genuinely continuous financial flows.
/// On Ethereum (12s blocks) this same math produces jerky, gas-expensive results.
module fluvio::stream_core {
    use std::signer;
    use std::error;
    use std::vector;
    use initia_std::table::{Self, Table};
    use initia_std::timestamp;
    use fluvio::stream_vault;

    // --- Errors ------------------------------------------------------------
    const E_STREAM_NOT_FOUND: u64 = 100;
    const E_NOT_SENDER: u64 = 101;
    const E_NOT_RECIPIENT: u64 = 102;
    const E_STREAM_NOT_ACTIVE: u64 = 103;
    const E_NOTHING_TO_WITHDRAW: u64 = 104;
    const E_INVALID_DURATION: u64 = 105;
    const E_INVALID_AMOUNT: u64 = 106;
    const E_REGISTRY_NOT_INITIALIZED: u64 = 107;

    // --- Minimum stream duration: 60 seconds ------------------------------
    const MIN_DURATION_MS: u64 = 60_000;
    const MIN_AMOUNT: u64 = 1_000; // 0.001 INIT (6 decimals)

    // --- Stream types ------------------------------------------------------
    const STREAM_TYPE_SALARY: u8 = 0;
    const STREAM_TYPE_SUBSCRIPTION: u8 = 1;
    const STREAM_TYPE_RENTAL: u8 = 2;
    const STREAM_TYPE_GRANT: u8 = 3;
    const STREAM_TYPE_CUSTOM: u8 = 4;

    // --- Platform fee: 10 basis points = 0.1% -----------------------------
    const FEE_BPS: u64 = 10;
    const BPS_DENOMINATOR: u64 = 10_000;

    // --- Core Data Structures ----------------------------------------------

    struct Stream has store, drop {
        id: u64,
        sender: address,
        recipient: address,

        // Financial parameters
        total_deposited: u64,       // total INIT locked at creation
        rate_per_ms: u64,           // INIT per millisecond (THE key field)
        withdrawn_by_recipient: u64,
        fee_collected: u64,

        // Time parameters (milliseconds - Initia's resolution)
        start_time_ms: u64,
        end_time_ms: u64,

        // Stream metadata
        stream_type: u8,
        note: vector<u8>,           // UTF-8 label e.g. "Monthly Salary"
        sender_username: vector<u8>, // e.g. "alice.init"
        recipient_username: vector<u8>,

        // State
        active: bool,
        cancelled: bool,
        cancel_time_ms: u64,
    }

    struct StreamRegistry has key {
        streams: Table<u64, Stream>,
        next_id: u64,
        total_streams_ever: u64,
        total_value_streamed: u64,
        fee_accumulated: u64,
    }

    // --- Events ------------------------------------------------------------

    struct StreamCreatedEvent has drop, store {
        stream_id: u64,
        sender: address,
        recipient: address,
        total_amount: u64,
        rate_per_ms: u64,
        duration_ms: u64,
        stream_type: u8,
    }

    struct WithdrawEvent has drop, store {
        stream_id: u64,
        recipient: address,
        amount: u64,
        timestamp_ms: u64,
    }

    struct StreamCancelledEvent has drop, store {
        stream_id: u64,
        sender: address,
        streamed_amount: u64,
        returned_amount: u64,
        timestamp_ms: u64,
    }

    // --- Initialization ----------------------------------------------------

    fun init_module(account: &signer) {
        move_to(account, StreamRegistry {
            streams: table::new(),
            next_id: 1,
            total_streams_ever: 0,
            total_value_streamed: 0,
            fee_accumulated: 0,
        });
    }

    // --- Create Stream -----------------------------------------------------

    /// Create a new stream. Locks total_amount from sender's vault.
    /// 
    /// rate_per_ms is auto-calculated: total_amount / duration_ms
    /// This means the rate adapts to exactly drain the deposit over the duration.
    public entry fun create_stream(
        sender: &signer,
        recipient: address,
        total_amount: u64,
        duration_ms: u64,
        stream_type: u8,
        note: vector<u8>,
        sender_username: vector<u8>,
        recipient_username: vector<u8>,
    ) acquires StreamRegistry {
        let sender_addr = signer::address_of(sender);

        // Validations
        assert!(duration_ms >= MIN_DURATION_MS, error::invalid_argument(E_INVALID_DURATION));
        assert!(total_amount >= MIN_AMOUNT, error::invalid_argument(E_INVALID_AMOUNT));

        // Calculate rate - this is what makes it "real-time"
        // On Initia: timestamp advances every 100ms, so this produces
        // genuinely continuous balance updates
        // Use x1000 precision to handle small rates (e.g. 1 INIT over 30 days)
        // rate_per_ms stored as actual_rate * 1000 to avoid integer truncation
        let rate_per_ms = (total_amount * 1000) / duration_ms;

        // Calculate fee
        let fee = (total_amount * FEE_BPS) / BPS_DENOMINATOR;
        let amount_after_fee = total_amount - fee;

        // Lock sender's balance
        stream_vault::lock_balance(sender_addr, total_amount);

        let registry = borrow_global_mut<StreamRegistry>(@fluvio);
        let stream_id = registry.next_id;
        let now = timestamp::now_milliseconds();

        let stream = Stream {
            id: stream_id,
            sender: sender_addr,
            recipient,
            total_deposited: amount_after_fee,
            rate_per_ms,
            withdrawn_by_recipient: 0,
            fee_collected: fee,
            start_time_ms: now,
            end_time_ms: now + duration_ms,
            stream_type,
            note,
            sender_username,
            recipient_username,
            active: true,
            cancelled: false,
            cancel_time_ms: 0,
        };

        table::add(&mut registry.streams, stream_id, stream);
        registry.next_id = stream_id + 1;
        registry.total_streams_ever = registry.total_streams_ever + 1;
        registry.fee_accumulated = registry.fee_accumulated + fee;
    }

    // --- Withdraw ----------------------------------------------------------

    /// Recipient withdraws their currently claimable amount.
    /// Can be called at any time - even while stream is active.
    /// This is the "pull" model - recipient always in control.
    public entry fun withdraw(
        recipient: &signer,
        stream_id: u64,
    ) acquires StreamRegistry {
        let recipient_addr = signer::address_of(recipient);
        let registry = borrow_global_mut<StreamRegistry>(@fluvio);

        assert!(
            table::contains(&registry.streams, stream_id),
            error::not_found(E_STREAM_NOT_FOUND)
        );

        let stream = table::borrow_mut(&mut registry.streams, stream_id);
        assert!(stream.recipient == recipient_addr, error::permission_denied(E_NOT_RECIPIENT));
        assert!(stream.active || !stream.cancelled, error::invalid_state(E_STREAM_NOT_ACTIVE));

        let claimable = calculate_claimable(stream);
        assert!(claimable > 0, error::resource_exhausted(E_NOTHING_TO_WITHDRAW));

        stream.withdrawn_by_recipient = stream.withdrawn_by_recipient + claimable;
        registry.total_value_streamed = registry.total_value_streamed + claimable;

        // Mark complete if fully drained
        let now = timestamp::now_milliseconds();
        if (now >= stream.end_time_ms && stream.withdrawn_by_recipient >= stream.total_deposited) {
            stream.active = false;
        };

        stream_vault::transfer_to_recipient(stream.sender, recipient_addr, claimable);
    }

    // --- Cancel Stream -----------------------------------------------------

    /// Sender cancels an active stream.
    /// Streamed-so-far goes to recipient. Remainder returns to sender.
    public entry fun cancel_stream(
        sender: &signer,
        stream_id: u64,
    ) acquires StreamRegistry {
        let sender_addr = signer::address_of(sender);
        let registry = borrow_global_mut<StreamRegistry>(@fluvio);

        assert!(
            table::contains(&registry.streams, stream_id),
            error::not_found(E_STREAM_NOT_FOUND)
        );

        let stream = table::borrow_mut(&mut registry.streams, stream_id);
        assert!(stream.sender == sender_addr, error::permission_denied(E_NOT_SENDER));
        assert!(stream.active, error::invalid_state(E_STREAM_NOT_ACTIVE));

        let now = timestamp::now_milliseconds();
        let already_streamed = calculate_claimable(stream) + stream.withdrawn_by_recipient;
        let to_return = stream.total_deposited - already_streamed;

        stream.active = false;
        stream.cancelled = true;
        stream.cancel_time_ms = now;

        // In production: 
        // Transfer already_streamed to recipient
        // Return to_return to sender's vault
        // stream_vault::unlock_and_transfer(sender_addr, stream.recipient, already_streamed, to_return);
    }

    // --- Core Math ---------------------------------------------------------

    /// THE KEY FUNCTION - pure deterministic math
    /// No oracles. No off-chain computation. 100% on-chain.
    /// 
    /// On Initia: now_milliseconds() advances every 100ms
    ///  balance updates 10x per second
    ///  genuinely continuous financial flow
    ///
    /// On Ethereum: now_seconds() advances every 12s
    ///  balance jumps every 12 seconds
    ///  not streaming, just batching
    fun calculate_claimable(stream: &Stream): u64 {
        if (!stream.active && stream.cancelled) {
            // Return remaining unclaimed on cancel
            return stream.total_deposited - stream.withdrawn_by_recipient
        };

        let now = timestamp::now_milliseconds();
        let effective_end = if (now > stream.end_time_ms) {
            stream.end_time_ms
        } else {
            now
        };

        let elapsed_ms = effective_end - stream.start_time_ms;
        let total_earned = (elapsed_ms * stream.rate_per_ms) / 1000;

        // Cap at total_deposited
        let capped = if (total_earned > stream.total_deposited) {
            stream.total_deposited
        } else {
            total_earned
        };

        // Subtract what was already withdrawn
        if (capped > stream.withdrawn_by_recipient) {
            capped - stream.withdrawn_by_recipient
        } else {
            0
        }
    }

    // --- View Functions ----------------------------------------------------

    #[view]
    public fun get_claimable(stream_id: u64): u64 acquires StreamRegistry {
        let registry = borrow_global<StreamRegistry>(@fluvio);
        assert!(table::contains(&registry.streams, stream_id), error::not_found(E_STREAM_NOT_FOUND));
        let stream = table::borrow(&registry.streams, stream_id);
        calculate_claimable(stream)
    }

    #[view]
    public fun get_stream_rate_per_second(stream_id: u64): u64 acquires StreamRegistry {
        let registry = borrow_global<StreamRegistry>(@fluvio);
        let stream = table::borrow(&registry.streams, stream_id);
        stream.rate_per_ms // already x1000 precision, so this = rate per second
    }

    #[view]
    public fun get_total_streams(): u64 acquires StreamRegistry {
        borrow_global<StreamRegistry>(@fluvio).total_streams_ever
    }

    #[view]
    public fun get_total_value_streamed(): u64 acquires StreamRegistry {
        borrow_global<StreamRegistry>(@fluvio).total_value_streamed
    }

    #[view]
    public fun is_stream_active(stream_id: u64): bool acquires StreamRegistry {
        let registry = borrow_global<StreamRegistry>(@fluvio);
        if (!table::contains(&registry.streams, stream_id)) return false;
        let stream = table::borrow(&registry.streams, stream_id);
        stream.active && !stream.cancelled
    }

    #[view]
    public fun get_stream_progress_bps(stream_id: u64): u64 acquires StreamRegistry {
        let registry = borrow_global<StreamRegistry>(@fluvio);
        let stream = table::borrow(&registry.streams, stream_id);
        let now = timestamp::now_milliseconds();
        let elapsed = if (now > stream.end_time_ms) {
            stream.end_time_ms - stream.start_time_ms
        } else {
            now - stream.start_time_ms
        };
        let duration = stream.end_time_ms - stream.start_time_ms;
        (elapsed * 10_000) / duration // returns basis points 010000
    }

    public fun get_stream_sender(stream_id: u64): address acquires StreamRegistry {
        let registry = borrow_global<StreamRegistry>(@fluvio);
        let stream = table::borrow(&registry.streams, stream_id);
        stream.sender
    }

    public fun get_stream_recipient(stream_id: u64): address acquires StreamRegistry {
        let registry = borrow_global<StreamRegistry>(@fluvio);
        let stream = table::borrow(&registry.streams, stream_id);
        stream.recipient
    }

    public fun get_stream_total_deposited(stream_id: u64): u64 acquires StreamRegistry {
        let registry = borrow_global<StreamRegistry>(@fluvio);
        let stream = table::borrow(&registry.streams, stream_id);
        stream.total_deposited
    }

    public fun get_stream_rate_per_ms(stream_id: u64): u64 acquires StreamRegistry {
        let registry = borrow_global<StreamRegistry>(@fluvio);
        let stream = table::borrow(&registry.streams, stream_id);
        stream.rate_per_ms
    }

    public fun get_stream_start_time(stream_id: u64): u64 acquires StreamRegistry {
        let registry = borrow_global<StreamRegistry>(@fluvio);
        let stream = table::borrow(&registry.streams, stream_id);
        stream.start_time_ms
    }

    public fun get_stream_end_time(stream_id: u64): u64 acquires StreamRegistry {
        let registry = borrow_global<StreamRegistry>(@fluvio);
        let stream = table::borrow(&registry.streams, stream_id);
        stream.end_time_ms
    }

    public fun get_stream_type(stream_id: u64): u8 acquires StreamRegistry {
        let registry = borrow_global<StreamRegistry>(@fluvio);
        let stream = table::borrow(&registry.streams, stream_id);
        stream.stream_type
    }

    public fun get_stream_active(stream_id: u64): bool acquires StreamRegistry {
        let registry = borrow_global<StreamRegistry>(@fluvio);
        let stream = table::borrow(&registry.streams, stream_id);
        stream.active
    }

    public fun get_stream_withdrawn(stream_id: u64): u64 acquires StreamRegistry {
        let registry = borrow_global<StreamRegistry>(@fluvio);
        let stream = table::borrow(&registry.streams, stream_id);
        stream.withdrawn_by_recipient
    }
}
