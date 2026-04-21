import { useState, useEffect } from 'react';
import * as bip39 from 'bip39';

const getStorageKey = (addr) => 'fluvio_session_key_' + (addr || 'default');
const GRANT_MSG_TYPE = '/initia.move.v1.MsgExecute';
const LCD_URL = 'https://rest.testnet.initia.xyz';

export function useSessionKey(userAddress, grantSessionKeyFn) {
  const [sessionMnemonic, setSessionMnemonic] = useState(null);
  const [sessionAddress, setSessionAddress] = useState(null);
  const [isGranting, setIsGranting] = useState(false);
  const [hasGrant, setHasGrant] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(getStorageKey(userAddress));
    if (!stored) return;
    try {
      const { mnemonic, address } = JSON.parse(stored);
      setSessionMnemonic(mnemonic);
      setSessionAddress(address);
    } catch {
      localStorage.removeItem(getStorageKey(userAddress));
    }
  }, []);

  // Skip on-chain grant check (testnet authz endpoint returns 500)
  // Trust localStorage instead - if session key is stored, grant was successful
  useEffect(() => {
    if (sessionAddress) setHasGrant(true);
  }, [sessionAddress]);

  async function enableSessionKey() {
    if (!userAddress) { alert('Connect your wallet first'); return; }
    setIsGranting(true);
    try {
      // Generate mnemonic using bip39 (pure JS, no Buffer issues)
      const mnemonic = bip39.generateMnemonic();
      console.log('Generated mnemonic (first 3 words):', mnemonic.split(' ').slice(0,3).join(' '));

      // Derive address using cosmjs (browser safe)
      const { Secp256k1HdWallet } = await import('@cosmjs/amino');
      const wallet = await Secp256k1HdWallet.fromMnemonic(mnemonic, { prefix: 'init' });
      const [{ address: ephemeralAddress }] = await wallet.getAccounts();
      console.log('Ephemeral address:', ephemeralAddress);

      // One Keplr popup for the grant
      await grantSessionKeyFn(userAddress, ephemeralAddress);

      const payload = { mnemonic, address: ephemeralAddress };
      localStorage.setItem(getStorageKey(userAddress), JSON.stringify(payload));
      setSessionMnemonic(mnemonic);
      setSessionAddress(ephemeralAddress);
      setHasGrant(true);
    } catch(e) {
      console.error('Session key error:', e);
      alert('Session key failed: ' + e.message);
    } finally {
      setIsGranting(false);
    }
  }

  function clearSessionKey() {
    localStorage.removeItem(getStorageKey(userAddress));
    setSessionMnemonic(null);
    setSessionAddress(null);
    setHasGrant(false);
  }

  return {
    sessionKey: sessionMnemonic ? { mnemonic: sessionMnemonic } : null,
    sessionAddress,
    hasGrant,
    isGranting,
    enableSessionKey,
    clearSessionKey,
  };
}
