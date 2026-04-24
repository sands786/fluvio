export const CHAIN_CONFIG = {
  chainId: 'initiation-2',
  rpcUrl: 'https://rpc.testnet.initia.xyz',
  lcdUrl: "https://rest.testnet.initia.xyz",
  contractAddress: '0xf229399249b5e72455cad9d5b2c17af99b7e3b4a',
  denom: 'uinit',
  decimals: 6,
}

export const formatINIT = (uinit: number): string => {
  return (uinit / 1_000_000).toFixed(4)
}
