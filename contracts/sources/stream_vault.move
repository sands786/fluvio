/// Fluvio - Vault module: holds user escrow balances
module fluvio::stream_vault {
    use std::signer;
    use std::error;
    use initia_std::fungible_asset;
    use initia_std::primary_fungible_store;
    use initia_std::object;

    friend fluvio::stream_core;

    const E_VAULT_NOT_FOUND: u64 = 200;
    const E_INSUFFICIENT_FREE_BALANCE: u64 = 201;

    struct Vault has key {
        total_balance: u64,
        locked_for_streams: u64,
        total_deposited_ever: u64,
        total_withdrawn_ever: u64,
    }

    fun init_module(_account: &signer) {}

    fun get_init_metadata(): object::Object<fungible_asset::Metadata> {
        let init_addr = @initia_std;
        object::address_to_object<fungible_asset::Metadata>(init_addr)
    }

    public entry fun initialize_vault(account: &signer) {
        let addr = signer::address_of(account);
        if (!exists<Vault>(addr)) {
            move_to(account, Vault {
                total_balance: 0,
                locked_for_streams: 0,
                total_deposited_ever: 0,
                total_withdrawn_ever: 0,
            });
        }
    }

    public entry fun deposit(account: &signer, amount: u64) acquires Vault {
        let addr = signer::address_of(account);
        if (!exists<Vault>(addr)) {
            move_to(account, Vault {
                total_balance: 0,
                locked_for_streams: 0,
                total_deposited_ever: 0,
                total_withdrawn_ever: 0,
            });
        };
        primary_fungible_store::transfer(
            account,
            get_init_metadata(),
            @fluvio,
            amount
        );
        let vault = borrow_global_mut<Vault>(addr);
        vault.total_balance = vault.total_balance + amount;
        vault.total_deposited_ever = vault.total_deposited_ever + amount;
    }

    public entry fun withdraw(account: &signer, amount: u64) acquires Vault {
        let addr = signer::address_of(account);
        assert!(exists<Vault>(addr), error::not_found(E_VAULT_NOT_FOUND));
        let vault = borrow_global_mut<Vault>(addr);
        let free = vault.total_balance - vault.locked_for_streams;
        assert!(free >= amount, error::resource_exhausted(E_INSUFFICIENT_FREE_BALANCE));
        vault.total_balance = vault.total_balance - amount;
        vault.total_withdrawn_ever = vault.total_withdrawn_ever + amount;
    }

    public(friend) fun lock_balance(owner: address, amount: u64) acquires Vault {
        assert!(exists<Vault>(owner), error::not_found(E_VAULT_NOT_FOUND));
        let vault = borrow_global_mut<Vault>(owner);
        vault.locked_for_streams = vault.locked_for_streams + amount;
    }

    public(friend) fun unlock_balance(owner: address, amount: u64) acquires Vault {
        if (!exists<Vault>(owner)) return;
        let vault = borrow_global_mut<Vault>(owner);
        if (vault.locked_for_streams >= amount) {
            vault.locked_for_streams = vault.locked_for_streams - amount;
            vault.total_balance = vault.total_balance - amount;
        }
    }

    public fun get_balance(addr: address): (u64, u64) acquires Vault {
        if (!exists<Vault>(addr)) return (0, 0);
        let vault = borrow_global<Vault>(addr);
        (vault.total_balance, vault.locked_for_streams)
    }
}
