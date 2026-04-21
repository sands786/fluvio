export const CHAIN_CONFIG = {
  chainId: 'initiation-2',
  rpcUrl: 'https://rpc.testnet.initia.xyz',
  lcdUrl: "https://rest.testnet.initia.xyz",
  contractAddress: 'init17g5nnyjfkhnjg4w2m82m9st6lxdhuw62zjgsmd',
  denom: 'uinit',
  decimals: 6,
}

export const formatINIT = (uinit: number): string => {
  return (uinit / 1_000_000).toFixed(4)
}
