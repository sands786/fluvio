import { useState, useEffect } from 'react'

const STORAGE_KEY = (addr: string) => `fluvio_session_key_${addr || 'default'}`

interface SessionKey {
  mnemonic: string
}

export function useSessionKey(
  userAddress: string,
  grantFn: (userAddress: string, sessionAddress: string) => Promise<any>
) {
  const [sessionKey, setSessionKey] = useState<SessionKey | null>(null)
  const [sessionAddress, setSessionAddress] = useState<string | null>(null)
  const [hasGrant, setHasGrant] = useState(false)
  const [isGranting, setIsGranting] = useState(false)

  // Load existing session key from localStorage
  useEffect(() => {
    if (!userAddress) return
    const stored = localStorage.getItem(STORAGE_KEY(userAddress))
    if (stored) {
      try {
        const { mnemonic, address } = JSON.parse(stored)
        setSessionKey({ mnemonic })
        setSessionAddress(address)
        setHasGrant(true)
      } catch {
        localStorage.removeItem(STORAGE_KEY(userAddress))
      }
    }
  }, [userAddress])

  const enableSessionKey = async () => {
    if (!userAddress) { alert('Connect your wallet first'); return }
    setIsGranting(true)
    try {
      const { entropyToMnemonic } = await import('@scure/bip39')
      const { wordlist } = await import('@scure/bip39/wordlists/english')
      const entropy = crypto.getRandomValues(new Uint8Array(16))
      const mnemonic = entropyToMnemonic(entropy, wordlist)

      const { Secp256k1HdWallet } = await import('@cosmjs/amino')
      const wallet = await Secp256k1HdWallet.fromMnemonic(mnemonic, { prefix: 'init' })
      const [{ address }] = await wallet.getAccounts()

      await grantFn(userAddress, address)

      const data = { mnemonic, address }
      localStorage.setItem(STORAGE_KEY(userAddress), JSON.stringify(data))
      setSessionKey({ mnemonic })
      setSessionAddress(address)
      setHasGrant(true)
    } catch (e: any) {
      alert('Session key failed: ' + e.message)
    } finally {
      setIsGranting(false)
    }
  }

  const clearSessionKey = () => {
    localStorage.removeItem(STORAGE_KEY(userAddress))
    setSessionKey(null)
    setSessionAddress(null)
    setHasGrant(false)
  }

  return { sessionKey, sessionAddress, hasGrant, isGranting, enableSessionKey, clearSessionKey }
}
