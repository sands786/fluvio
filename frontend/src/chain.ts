export const CHAIN_CONFIG = {
  chainId: 'initiation-2',
  rpcUrl: 'https://rpc.testnet.initia.xyz',
  lcdUrl: "https://rest.testnet.initia.xyz",
  contractAddress: 'init1eqynxvpnvqh75su2fyta6xys6re7hzz3rkapqx',
  denom: 'uinit',
  decimals: 6,
}

export const formatINIT = (uinit: number): string => {
  return (uinit / 1_000_000).toFixed(4)
}
