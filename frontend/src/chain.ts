export const CHAIN_CONFIG = {
  chainId: 'initiation-2',
  rpcUrl: 'https://rpc.testnet.initia.xyz',
  lcdUrl: "https://rest.testnet.initia.xyz",
  contractAddress: '0xc809333033602fea438a4917dd1890d0f3eb8851',
  denom: 'uinit',
  decimals: 6,
}

export const formatINIT = (uinit: number): string => {
  return (uinit / 1_000_000).toFixed(4)
}
