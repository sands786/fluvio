/// Fluvio Stream Registry
/// Public stats oracle - any app on Initia can query total ecosystem flow
module fluvio::stream_registry {
    use initia_std::timestamp;
    use fluvio::stream_core;

    // --- Global Stats ------------------------------------------------------

    struct EcosystemStats has key {
        total_active_streams: u64,
        total_value_streaming_per_second: u64, // sum of all active stream rates
        all_time_streams: u64,
        all_time_value_streamed: u64,
        last_updated_ms: u64,
    }

    fun init_module(account: &signer) {
        move_to(account, EcosystemStats {
            total_active_streams: 0,
            total_value_streaming_per_second: 0,
            all_time_streams: 0,
            all_time_value_streamed: 0,
            last_updated_ms: 0,
        });
    }

    // --- View Functions ----------------------------------------------------

    #[view]
    public fun get_ecosystem_flow_per_second(): u64 acquires EcosystemStats {
        borrow_global<EcosystemStats>(@fluvio).total_value_streaming_per_second
    }

    #[view]
    public fun get_active_stream_count(): u64 acquires EcosystemStats {
        borrow_global<EcosystemStats>(@fluvio).total_active_streams
    }

    #[view]
    public fun get_all_time_value_streamed(): u64 {
        stream_core::get_total_value_streamed()
    }

    /// The "WOW" number for the demo:
    /// How much INIT has flowed since the registry started
    #[view]
    public fun get_total_init_ever_streamed(): u64 {
        stream_core::get_total_value_streamed()
    }

    // --- Public update (called by stream_core on create/cancel) ------------

    public(friend) fun on_stream_created(rate_per_ms: u64) acquires EcosystemStats {
        let stats = borrow_global_mut<EcosystemStats>(@fluvio);
        stats.total_active_streams = stats.total_active_streams + 1;
        stats.all_time_streams = stats.all_time_streams + 1;
        stats.total_value_streaming_per_second =
            stats.total_value_streaming_per_second + (rate_per_ms * 1000);
        stats.last_updated_ms = timestamp::now_milliseconds();
    }

    public(friend) fun on_stream_ended(rate_per_ms: u64) acquires EcosystemStats {
        let stats = borrow_global_mut<EcosystemStats>(@fluvio);
        if (stats.total_active_streams > 0) {
            stats.total_active_streams = stats.total_active_streams - 1;
        };
        if (stats.total_value_streaming_per_second >= rate_per_ms * 1000) {
            stats.total_value_streaming_per_second =
                stats.total_value_streaming_per_second - (rate_per_ms * 1000);
        };
        stats.last_updated_ms = timestamp::now_milliseconds();
    }
}
