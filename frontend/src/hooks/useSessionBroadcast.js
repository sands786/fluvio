import { MnemonicKey, LCDClient, Wallet, MsgExecAuthorized } from '@initia/initia.js';

const LCD_URL = 'https://lcd.initiation-2.initia.xyz';
const CHAIN_ID = 'initiation-2';

export async function sessionBroadcast(sessionKey, sessionAddress, msgs) {
  if (!sessionKey || !sessionAddress) throw new Error('No session key active');

  const lcd = new LCDClient(LCD_URL, {
    chainId: CHAIN_ID,
    gasPrices: '0.015uinit',
  });

  const wallet = new Wallet(lcd, sessionKey);

  // Wrap msgs in MsgExecAuthorized so session key acts on user's behalf
  const execMsg = new MsgExecAuthorized(sessionAddress, msgs);

  const tx = await wallet.createAndSignTx({
    msgs: [execMsg],
    memo: 'fluvio-session',
  });

  const result = await lcd.tx.broadcast(tx);

  if (result.code !== 0) {
    throw new Error(`Tx failed: ${result.raw_log}`);
  }

  return result;
}
