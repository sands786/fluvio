import { useCallback } from 'react'
import { CHAIN_CONFIG } from './chain'
import { Msg, MsgGrantAuthorization, AuthorizationGrant, GenericAuthorization, MsgExecAuthorized, bcs } from '@initia/initia.js'

const REST_URL = 'https://rest.testnet.initia.xyz'
const CHAIN_ID = 'initiation-2'

function buildMoveMsgAmino(sender: string, moduleName: string, functionName: string, args: string[]) {
  return {
    type: 'move/MsgExecute',
    value: {
      sender,
      module_address: CHAIN_CONFIG.contractAddress,
      module_name: moduleName,
      function_name: functionName,
      type_args: [],
      args,
    }
  }
}

export async function broadcastMoveMsg(moduleName: string, functionName: string, args: string[]) {
  if (!window.keplr) throw new Error('Keplr not found')
  await window.keplr.enable(CHAIN_ID)
  const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID)
  const accounts = await offlineSigner.getAccounts()
  const actualSender = accounts[0].address

  const accRes = await fetch(REST_URL + '/cosmos/auth/v1beta1/accounts/' + actualSender)
  const accData = await accRes.json()
  const baseAccount = accData.account?.base_account || accData.account
  const accountNumber = parseInt(baseAccount?.account_number || '0')
  const sequence = parseInt(baseAccount?.sequence || '0')

  // Msg already imported
  const msg = Msg.fromAmino(buildMoveMsgAmino(actualSender, moduleName, functionName, args))
  const msgAny = msg.packAny()

  const { encodePubkey, makeAuthInfoBytes, makeSignDoc } = await import('@cosmjs/proto-signing')
  const { TxRaw, TxBody } = await import('cosmjs-types/cosmos/tx/v1beta1/tx')
  const { SignMode } = await import('cosmjs-types/cosmos/tx/signing/v1beta1/signing')
  const { fromBase64 } = await import('@cosmjs/encoding')

  const txBodyBytes = TxBody.encode(TxBody.fromPartial({
    messages: [{ typeUrl: msgAny.typeUrl, value: msgAny.value }],
    memo: '',
  })).finish()

  const key = await window.keplr.getKey(CHAIN_ID)
  const pubkey = encodePubkey({
    type: 'tendermint/PubKeySecp256k1',
    value: Buffer.from(key.pubKey).toString('base64'),
  })

  const authInfoBytes = makeAuthInfoBytes(
    [{ pubkey, sequence }],
    [{ denom: 'uinit', amount: '50000' }],
    500000, undefined, undefined,
    SignMode.SIGN_MODE_DIRECT
  )

  const signDoc = makeSignDoc(txBodyBytes, authInfoBytes, CHAIN_ID, accountNumber)
  const { signed, signature } = await window.keplr.signDirect(CHAIN_ID, actualSender, signDoc)

  const txRaw = TxRaw.fromPartial({
    bodyBytes: signed.bodyBytes,
    authInfoBytes: signed.authInfoBytes,
    signatures: [fromBase64(signature.signature)],
  })

  const txBytes = Buffer.from(TxRaw.encode(txRaw).finish()).toString('base64')
  return broadcastTxBytes(txBytes)
}

async function broadcastTxBytes(txBytes: string) {
  const res = await fetch(REST_URL + '/cosmos/tx/v1beta1/txs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txBytes, mode: 'BROADCAST_MODE_SYNC' })
  })
  const result = await res.json()
  console.log('Broadcast result:', JSON.stringify(result))
  if (result.tx_response?.code && result.tx_response.code !== 0) {
    throw new Error('Chain error ' + result.tx_response.code + ': ' + result.tx_response.raw_log)
  }
  return result
}

export async function grantSessionKey(userAddress: string, sessionAddress: string) {
  if (!window.keplr) throw new Error('Keplr not found')
  await window.keplr.enable(CHAIN_ID)
  const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID)
  const accounts = await offlineSigner.getAccounts()
  const granter = accounts[0].address

  const accRes = await fetch(REST_URL + '/cosmos/auth/v1beta1/accounts/' + granter)
  const accData = await accRes.json()
  const baseAccount = accData.account?.base_account || accData.account
  const accountNumber = parseInt(baseAccount?.account_number || '0')
  const sequence = parseInt(baseAccount?.sequence || '0')

  const expiry = new Date()
  expiry.setDate(expiry.getDate() + 7)
  const expiryStr = expiry.toISOString().replace(/\.\d{3}Z$/, 'Z')

  const aminoMsg = {
    type: 'cosmos-sdk/MsgGrant',
    value: {
      granter,
      grantee: sessionAddress,
      grant: {
        authorization: {
          type: 'cosmos-sdk/GenericAuthorization',
          value: { msg: '/initia.move.v1.MsgExecute' }
        },
        expiration: expiryStr
      }
    }
  }

  const signDoc = {
    chain_id: CHAIN_ID,
    account_number: String(accountNumber),
    sequence: String(sequence),
    fee: { amount: [{ denom: 'uinit', amount: '20000' }], gas: '200000' },
    msgs: [aminoMsg],
    memo: 'fluvio-session-grant'
  }

  const { signed, signature } = await window.keplr.signAmino(CHAIN_ID, granter, signDoc)
  console.log('Grant signed:', JSON.stringify(signed))

  const broadcastBody = {
    tx: {
      msg: signed.msgs,
      fee: signed.fee,
      signatures: [{
        pub_key: { type: 'tendermint/PubKeySecp256k1', value: signature.pub_key.value },
        signature: signature.signature
      }],
      memo: signed.memo
    },
    mode: 'sync'
  }

  const res = await fetch(REST_URL + '/txs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(broadcastBody)
  })
  const result = await res.json()
  console.log('Grant result:', JSON.stringify(result))
  if (result.code && result.code !== 0) {
    throw new Error('Grant failed: ' + (result.raw_log || result.message))
  }
  return result
}

export async function sessionBroadcastMoveMsg(
  sessionMnemonic: string,
  sessionAddress: string,
  userAddress: string,
  moduleName: string,
  functionName: string,
  args: string[]
) {
  // Use cosmjs to sign with session key - avoids Buffer issues with initia.js
  const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing')
  const { encodePubkey, makeAuthInfoBytes, makeSignDoc } = await import('@cosmjs/proto-signing')
  const { TxRaw, TxBody } = await import('cosmjs-types/cosmos/tx/v1beta1/tx')
  const { SignMode } = await import('cosmjs-types/cosmos/tx/signing/v1beta1/signing')
  const { fromBase64 } = await import('@cosmjs/encoding')
  // Msg already imported

  // Derive session wallet from mnemonic
  const sessionWallet = await DirectSecp256k1HdWallet.fromMnemonic(sessionMnemonic, { prefix: 'init' })
  const [sessionAccount] = await sessionWallet.getAccounts()

  // Get session key account info
  const accRes = await fetch(REST_URL + '/cosmos/auth/v1beta1/accounts/' + sessionAddress)
  const accData = await accRes.json()
  const baseAccount = accData.account?.base_account || accData.account
  const accountNumber = parseInt(baseAccount?.account_number || '0')
  const sequence = parseInt(baseAccount?.sequence || '0')

  // Build inner MsgExecute (user is sender)
  const innerMsg = Msg.fromAmino(buildMoveMsgAmino(userAddress, moduleName, functionName, args))
  const innerMsgAny = innerMsg.packAny()

  // Build MsgExecAuthorized wrapping it
  // already imported
  const execMsg = new MsgExecAuthorized(sessionAddress, [innerMsg])
  const execMsgAny = execMsg.packAny()

  const txBodyBytes = TxBody.encode(TxBody.fromPartial({
    messages: [{ typeUrl: execMsgAny.typeUrl, value: execMsgAny.value }],
    memo: 'fluvio-session',
  })).finish()

  const pubkey = encodePubkey({
    type: 'tendermint/PubKeySecp256k1',
    value: Buffer.from(sessionAccount.pubkey).toString('base64'),
  })

  const authInfoBytes = makeAuthInfoBytes(
    [{ pubkey, sequence }],
    [{ denom: 'uinit', amount: '20000' }],
    200000, undefined, undefined,
    SignMode.SIGN_MODE_DIRECT
  )

  const signDoc = makeSignDoc(txBodyBytes, authInfoBytes, CHAIN_ID, accountNumber)
  const { signature } = await sessionWallet.signDirect(sessionAddress, signDoc)

  const txRaw = TxRaw.fromPartial({
    bodyBytes: txBodyBytes,
    authInfoBytes,
    signatures: [fromBase64(signature.signature)],
  })

  const txBytes = Buffer.from(TxRaw.encode(txRaw).finish()).toString('base64')
  return broadcastTxBytes(txBytes)
}

export function useContract() {
  const createStream = useCallback(async (
    senderAddress: string,
    recipientAddress: string,
    amountUinit: number,
    durationMs: number,
    streamType: number = 0,
    note: string = '',
    senderUsername: string = 'user.init',
    recipientUsername: string = 'recipient.init'
  ) => {
    if (!senderAddress) throw new Error('Wallet not connected')
    // bcs already imported
    const recipientArg = Buffer.from(bcs.address().serialize(recipientAddress).toBytes()).toString('base64')
    const amountArg = Buffer.from(bcs.u64().serialize(BigInt(amountUinit)).toBytes()).toString('base64')
    const durationArg = Buffer.from(bcs.u64().serialize(BigInt(durationMs)).toBytes()).toString('base64')
    const streamTypeArg = Buffer.from(bcs.u8().serialize(streamType).toBytes()).toString('base64')
    const noteArg = Buffer.from(bcs.vector(bcs.u8()).serialize(Array.from(Buffer.from(note))).toBytes()).toString('base64')
    const senderUsernameArg = Buffer.from(bcs.vector(bcs.u8()).serialize(Array.from(Buffer.from(senderUsername))).toBytes()).toString('base64')
    const recipientUsernameArg = Buffer.from(bcs.vector(bcs.u8()).serialize(Array.from(Buffer.from(recipientUsername))).toBytes()).toString('base64')
    return broadcastMoveMsg('stream_core', 'create_stream', [
      recipientArg, amountArg, durationArg, streamTypeArg, noteArg, senderUsernameArg, recipientUsernameArg
    ])
  }, [])

  const withdrawStream = useCallback(async (
    senderAddress: string,
    streamId: number,
    sessionMnemonic?: string,
    sessionAddress?: string
  ) => {
    // bcs already imported
    const idArg = Buffer.from(bcs.u64().serialize(BigInt(streamId)).toBytes()).toString('base64')
    if (sessionMnemonic && sessionAddress) {
      return sessionBroadcastMoveMsg(sessionMnemonic, sessionAddress, senderAddress, 'stream_core', 'withdraw', [idArg])
    }
    return broadcastMoveMsg('stream_core', 'withdraw', [idArg])
  }, [])

  const cancelStream = useCallback(async (senderAddress: string, streamId: number) => {
    // bcs already imported
    const idArg = Buffer.from(bcs.u64().serialize(BigInt(streamId)).toBytes()).toString('base64')
    return broadcastMoveMsg('stream_core', 'cancel_stream', [idArg])
  }, [])

  return { createStream, withdrawStream, cancelStream }
}

export async function initializeVault(senderAddress: string) {
  return broadcastMoveMsg('stream_vault', 'initialize_vault', [])
}
