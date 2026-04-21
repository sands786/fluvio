import { useState, useCallback } from 'react'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WalletState {
  connected: boolean
  address: string | null
  username: string | null  // .init username e.g. "shahmeer.init"
  balance: number
}

export interface SessionKey {
  key: string
  expiresAt: number
  permissions: string[]
  maxSpend: number
}

export interface CreateStreamParams {
  recipientUsername: string
  totalAmount: number  // in INIT
  durationMs: number
  streamType: 'salary' | 'subscription' | 'rental' | 'grant' | 'custom'
  note: string
}

// ─── InterwovenKit Hook ─────────────────────────────────────────────────────

export function useInterwovenKit() {
  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    address: null,
    username: null,
    balance: 0,
  })
  const [sessionKey, setSessionKey] = useState<SessionKey | null>(null)
  const [loading, setLoading] = useState(false)

  // Connect wallet via InterwovenKit
  // In production: import { useWallet } from '@initia/interwovenkit-react'
  const connect = useCallback(async () => {
    setLoading(true)
    try {
      // Production code:
      // const { connect } = useWallet()
      // await connect()
      // const { address, username } = wallet

      // Demo simulation:
      await new Promise(r => setTimeout(r, 800))
      setWallet({
        connected: true,
        address: '0xdef456abc789...',
        username: 'shahmeer.init',
        balance: 5000,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setWallet({ connected: false, address: null, username: null, balance: 0 })
    setSessionKey(null)
  }, [])

  // Create a session key for auto-signing
  // This is the KEY Initia feature — sign ONCE, stream for N days
  const createSessionKey = useCallback(async (
    durationDays: number,
    maxSpendINIT: number
  ): Promise<SessionKey> => {
    // Production code:
    // const { signTx } = useWallet()
    // const tx = buildSessionKeyTx({ duration, maxSpend, permissions: ['create_stream', 'withdraw'] })
    // const result = await signTx(tx)

    // Demo simulation:
    await new Promise(r => setTimeout(r, 500))
    const key: SessionKey = {
      key: `sk_${Math.random().toString(36).slice(2)}`,
      expiresAt: Date.now() + durationDays * 86400000,
      permissions: ['create_stream', 'withdraw'],
      maxSpend: maxSpendINIT,
    }
    setSessionKey(key)
    return key
  }, [])

  // Create a stream on-chain via the Fluvio contract
  const createStream = useCallback(async (params: CreateStreamParams) => {
    if (!wallet.connected) throw new Error('Wallet not connected')

    setLoading(true)
    try {
      // Ensure session key exists (create if not)
      let sk = sessionKey
      if (!sk) {
        sk = await createSessionKey(
          Math.ceil(params.durationMs / 86400000),
          params.totalAmount
        )
      }

      // Production code:
      // const tx = buildCreateStreamTx({
      //   moduleAddress: FLUVIO_CONTRACT_ADDRESS,
      //   recipientUsername: params.recipientUsername,
      //   totalAmount: BigInt(Math.floor(params.totalAmount * 1e6)), // 6 decimals
      //   durationMs: BigInt(params.durationMs),
      //   streamType: STREAM_TYPES[params.streamType],
      //   note: params.note,
      //   senderUsername: wallet.username,
      //   recipientUsername: params.recipientUsername,
      // })
      // const result = await signTx(tx, { sessionKey: sk.key })
      // return result.txHash

      // Demo simulation:
      await new Promise(r => setTimeout(r, 1200))
      return `0x${Math.random().toString(16).slice(2).padEnd(64, '0')}`
    } finally {
      setLoading(false)
    }
  }, [wallet, sessionKey, createSessionKey])

  // Withdraw claimable amount from a stream
  const withdraw = useCallback(async (streamId: number): Promise<string> => {
    if (!wallet.connected) throw new Error('Wallet not connected')

    setLoading(true)
    try {
      // Production code:
      // const tx = buildWithdrawTx({ moduleAddress: FLUVIO_CONTRACT_ADDRESS, streamId })
      // const result = await signTx(tx, { sessionKey: sessionKey?.key })
      // return result.txHash

      await new Promise(r => setTimeout(r, 800))
      return `0x${Math.random().toString(16).slice(2).padEnd(64, '0')}`
    } finally {
      setLoading(false)
    }
  }, [wallet, sessionKey])

  // Cancel a stream (sender only)
  const cancelStream = useCallback(async (streamId: number): Promise<string> => {
    if (!wallet.connected) throw new Error('Wallet not connected')

    setLoading(true)
    try {
      await new Promise(r => setTimeout(r, 800))
      return `0x${Math.random().toString(16).slice(2).padEnd(64, '0')}`
    } finally {
      setLoading(false)
    }
  }, [wallet])

  // Bridge deposit via Interwoven Bridge
  // Users can deposit USDC from Ethereum/Solana and stream on Initia
  const bridgeDeposit = useCallback(async (
    fromChain: 'ethereum' | 'solana' | 'arbitrum',
    amountUSDC: number
  ): Promise<string> => {
    setLoading(true)
    try {
      // Production code:
      // const bridgeTx = await interwovenBridge.deposit({
      //   from: fromChain,
      //   to: 'fluvio-1',
      //   amount: amountUSDC,
      //   token: 'USDC',
      //   recipient: wallet.address,
      // })
      // return bridgeTx.hash

      await new Promise(r => setTimeout(r, 1500))
      return `bridge_${Math.random().toString(16).slice(2)}`
    } finally {
      setLoading(false)
    }
  }, [wallet])

  return {
    wallet,
    sessionKey,
    loading,
    connect,
    disconnect,
    createSessionKey,
    createStream,
    withdraw,
    cancelStream,
    bridgeDeposit,
  }
}

// ─── Contract constants ─────────────────────────────────────────────────────
export const FLUVIO_CONTRACT_ADDRESS = '0x1234' // replace after deployment
export const FLUVIO_CHAIN_ID = 'fluvio-1'
export const FLUVIO_RPC = 'https://rpc.fluvio-1.initia.xyz'
