import { useState, useCallback } from 'react'

export function useWallet() {
  const [wallet, setWallet] = useState({
    connected: false,
    address: '',
    hexAddress: '',
    username: '',
    balance: '0.0000',
    rawBalance: 0,
  })

  const connect = useCallback(async () => {
    if (!window.keplr) return alert('Please install Keplr')
    await window.keplr.experimentalSuggestChain({
      chainId: 'initiation-2',
      chainName: 'Initia Testnet',
      rpc: 'https://rpc.testnet.initia.xyz',
      rest: 'https://rest.testnet.initia.xyz',
      bip44: { coinType: 118 },
      bech32Config: {
        bech32PrefixAccAddr: 'init',
        bech32PrefixAccPub: 'initpub',
        bech32PrefixValAddr: 'initvaloper',
        bech32PrefixValPub: 'initvaloperpub',
        bech32PrefixConsAddr: 'initvalcons',
        bech32PrefixConsPub: 'initvalconspub',
      },
      currencies: [{ coinDenom: 'INIT', coinMinimalDenom: 'uinit', coinDecimals: 6 }],
      feeCurrencies: [{ coinDenom: 'INIT', coinMinimalDenom: 'uinit', coinDecimals: 6 }],
      stakeCurrency: { coinDenom: 'INIT', coinMinimalDenom: 'uinit', coinDecimals: 6 },
    })
    await window.keplr.enable('initiation-2')
    const offlineSigner = window.keplr.getOfflineSigner('initiation-2')
    const accounts = await offlineSigner.getAccounts()
    const address = accounts[0].address

    // Get hex address from Keplr key
    const key = await window.keplr.getKey('initiation-2')
    const hexAddress = '0x' + Buffer.from(key.address).toString('hex')

    const res = await fetch(`https://rest.testnet.initia.xyz/cosmos/bank/v1beta1/balances/${address}`)
    const data = await res.json()
    const balance = data.balances?.find((b: any) => b.denom === 'uinit')?.amount || '0'
    const initBalance = (parseInt(balance) / 1_000_000).toFixed(4)

    setWallet({
      connected: true,
      address,
      hexAddress,
      username: address.slice(0, 10) + '...' + address.slice(-4),
      balance: initBalance,
      rawBalance: parseInt(balance),
    })
  }, [])

  const disconnect = useCallback(() => {
    setWallet({ connected: false, address: '', hexAddress: '', username: '', balance: '0.0000', rawBalance: 0 })
  }, [])

  const refreshBalance = useCallback(async () => {
    if (!wallet.connected || !wallet.address) return
    try {
      const res = await fetch(`https://rest.testnet.initia.xyz/cosmos/bank/v1beta1/balances/${wallet.address}`, { cache: 'no-store' })
      const data = await res.json()
      const balance = data.balances?.find((b: any) => b.denom === 'uinit')?.amount || '0'
      const initBalance = (parseInt(balance) / 1_000_000).toFixed(4)
      setWallet(prev => ({ ...prev, balance: initBalance, rawBalance: parseInt(balance) }))
    } catch {}
  }, [wallet.connected, wallet.address])

  return { wallet, connect, disconnect, refreshBalance }
}
