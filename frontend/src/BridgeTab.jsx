import { useState, useEffect } from 'react'

const REST_URL = 'https://rest.testnet.initia.xyz'
const CHAIN_ID = 'initiation-2'

const BRIDGES = [
  { id: 1, name: 'Minimove', description: 'Move-based Minitia' },
  { id: 2, name: 'Miniwasm', description: 'Wasm-based Minitia' },
  { id: 3, name: 'Minievm', description: 'EVM-based Minitia' },
]

async function broadcastAmino(aminoMsg, chainId, restUrl) {
  if (!window.keplr) throw new Error('Keplr not found')
  await window.keplr.enable(chainId)
  const offlineSigner = window.keplr.getOfflineSigner(chainId)
  const accounts = await offlineSigner.getAccounts()
  const sender = accounts[0].address

  const accRes = await fetch(restUrl + '/cosmos/auth/v1beta1/accounts/' + sender, { cache: 'no-store' })
  const accData = await accRes.json()
  const base = accData.account?.base_account || accData.account
  const accountNumber = parseInt(base?.account_number || '0')
  const sequence = parseInt(base?.sequence || '0')

  const { Msg } = await import('@initia/initia.js')
  const { encodePubkey, makeAuthInfoBytes, makeSignDoc } = await import('@cosmjs/proto-signing')
  const { TxRaw, TxBody } = await import('cosmjs-types/cosmos/tx/v1beta1/tx')
  const { SignMode } = await import('cosmjs-types/cosmos/tx/signing/v1beta1/signing')
  const { fromBase64 } = await import('@cosmjs/encoding')

  const msg = Msg.fromAmino(aminoMsg)
  const msgAny = msg.packAny()
  console.log('packAny typeUrl:', msgAny.typeUrl, 'value bytes:', msgAny.value?.length)

  const txBodyBytes = TxBody.encode(TxBody.fromPartial({
    messages: [{ typeUrl: msgAny.typeUrl, value: msgAny.value }],
    memo: 'fluvio-bridge',
  })).finish()

  const key = await window.keplr.getKey(chainId)
  const pubkey = encodePubkey({
    type: 'tendermint/PubKeySecp256k1',
    value: Buffer.from(key.pubKey).toString('base64'),
  })
  const authInfoBytes = makeAuthInfoBytes(
    [{ pubkey, sequence }],
    [{ denom: 'uinit', amount: '20000' }],
    200000, undefined, undefined,
    SignMode.SIGN_MODE_DIRECT
  )
  const signDoc = makeSignDoc(txBodyBytes, authInfoBytes, chainId, accountNumber)
  const { signed, signature } = await window.keplr.signDirect(chainId, sender, signDoc)
  console.log('signed bodyBytes length:', signed.bodyBytes?.length, 'authInfoBytes:', signed.authInfoBytes?.length)
  const txRaw = TxRaw.fromPartial({
    bodyBytes: signed.bodyBytes,
    authInfoBytes: signed.authInfoBytes,
    signatures: [fromBase64(signature.signature)],
  })
  const txBytes = Buffer.from(TxRaw.encode(txRaw).finish()).toString('base64')

  const res = await fetch(restUrl + '/cosmos/tx/v1beta1/txs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txBytes, mode: 'BROADCAST_MODE_SYNC' })
  })
  const result = await res.json()
  console.log('Bridge result:', JSON.stringify(result))
  if (result.tx_response?.code && result.tx_response.code !== 0) {
    throw new Error('Bridge failed: ' + result.tx_response.raw_log)
  }
  return { txhash: result.tx_response?.txhash, code: 0 }
}

export function BridgeTab({ walletAddress, onSuccess }) {
  const [mode, setMode] = useState('deposit')
  const [amount, setAmount] = useState('')
  const [selectedBridge, setSelectedBridge] = useState(1)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)
  const [pendingTxs, setPendingTxs] = useState([])
  const [l1Balance, setL1Balance] = useState(null)

  useEffect(() => {
    if (!walletAddress) return
    fetchBalance(walletAddress)
    const stored = localStorage.getItem('fluvio_bridge_txs')
    if (stored) try { setPendingTxs(JSON.parse(stored)) } catch {}
  }, [walletAddress])

  async function fetchBalance(addr) {
    try {
      const res = await fetch(REST_URL + '/cosmos/bank/v1beta1/balances/' + addr)
      const data = await res.json()
      const init = data.balances?.find(b => b.denom === 'uinit')
      setL1Balance(init ? (parseInt(init.amount) / 1e6).toFixed(4) : '0')
    } catch { setL1Balance('?') }
  }

  function saveTx(tx) {
    const updated = [tx, ...pendingTxs.slice(0, 4)]
    setPendingTxs(updated)
    localStorage.setItem('fluvio_bridge_txs', JSON.stringify(updated))
  }

  async function handleDeposit() {
    if (!amount || parseFloat(amount) <= 0) return setStatus({ type: 'error', msg: 'Enter a valid amount' })
    setLoading(true)
    setStatus({ type: 'info', msg: 'Waiting for Keplr approval...' })
    try {
      await window.keplr.enable(CHAIN_ID)
      const accounts = await window.keplr.getOfflineSigner(CHAIN_ID).getAccounts()
      const sender = accounts[0].address
      const amountUinit = Math.floor(parseFloat(amount) * 1e6).toString()
      const aminoMsg = {
        type: 'ophost/MsgInitiateTokenDeposit',
        value: { sender, bridge_id: String(selectedBridge), to: walletAddress, amount: { denom: 'uinit', amount: amountUinit }, data: '' }
      }
      const result = await broadcastAmino(aminoMsg, CHAIN_ID, REST_URL)
      saveTx({ hash: result.txhash, amount, bridge: selectedBridge, type: 'deposit', timestamp: Date.now() })
      setStatus({ type: 'success', msg: amount + ' INIT deposited to ' + (BRIDGES.find(b=>b.id===selectedBridge)?.name) + '. Arrives in ~1hr after finalization.', hash: result.txhash })
      setAmount('')
      setTimeout(() => fetchBalance(walletAddress), 5000)
    } catch(e) {
      setStatus({ type: 'error', msg: e.message })
    } finally { setLoading(false) }
  }

  async function handleWithdraw() {
    // MsgInitiateTokenWithdrawal must be called from a Minitia chain, not L1
    // Show instructions instead
    setStatus({
      type: 'info',
      msg: 'To withdraw from a Minitia, connect Keplr to the Minitia RPC (e.g. Minimove testnet) and call MsgInitiateTokenWithdrawal. The OPinit relayer will automatically finalize it on Initia L1 within ~1hr. Once INIT arrives on L1, use the Fluvio Dashboard to deposit and start streaming.'
    })
  }

  if (!walletAddress) return (
    <div style={{textAlign:'center', padding:'60px 20px', color:'#888'}}>Connect your wallet to use the bridge</div>
  )

  const isDeposit = mode === 'deposit'
  const bridgeName = BRIDGES.find(b=>b.id===selectedBridge)?.name

  return (
    <div style={{maxWidth:'560px', margin:'0 auto', padding:'24px'}}>
      <div style={{marginBottom:'24px'}}>
        <h2 style={{color:'#e2e8f0', fontSize:'1.4rem', marginBottom:'8px'}}>Interwoven Bridge</h2>
        <p style={{color:'#888', fontSize:'0.9rem'}}>Move INIT between Initia L1 and Minitias via OPinit — Initia's native optimistic bridge.</p>
      </div>

      <div style={{display:'flex', background:'#0d1117', border:'1px solid #21262d', borderRadius:'10px', padding:'4px', marginBottom:'24px'}}>
        {[['deposit','Deposit L1 → Minitia'],['withdraw','Withdraw Minitia → L1']].map(([m, label]) => (
          <button key={m} onClick={() => { setMode(m); setStatus(null); setAmount('') }}
            style={{flex:1, padding:'10px', borderRadius:'8px', border:'none', cursor:'pointer',
              background: mode===m ? 'linear-gradient(135deg,#7c3aed,#2563eb)' : 'transparent',
              color: mode===m ? 'white' : '#888', fontSize:'0.85rem', fontWeight: mode===m ? '600' : '400'}}>
            {label}
          </button>
        ))}
      </div>

      <div style={{background:'#0d1117', border:'1px solid #21262d', borderRadius:'12px', padding:'16px', marginBottom:'20px'}}>
        <div style={{color:'#888', fontSize:'0.8rem', marginBottom:'4px'}}>Your Initia L1 Balance</div>
        <div style={{color:'#00ff88', fontSize:'1.4rem', fontWeight:'700'}}>{l1Balance ?? '...'} INIT</div>
        <div style={{color:'#555', fontSize:'0.75rem', marginTop:'4px'}}>{walletAddress?.slice(0,24)}...</div>
      </div>

      {isDeposit && (
        <div style={{marginBottom:'20px'}}>
          <div style={{color:'#888', fontSize:'0.85rem', marginBottom:'8px'}}>Destination Minitia</div>
          <div style={{display:'flex', gap:'8px', flexWrap:'wrap'}}>
            {BRIDGES.map(b => (
              <button key={b.id} onClick={() => setSelectedBridge(b.id)}
                style={{padding:'8px 16px', borderRadius:'8px',
                  border: selectedBridge===b.id ? '1px solid #7c3aed' : '1px solid #21262d',
                  background: selectedBridge===b.id ? '#1e1b4b' : '#0d1117',
                  color: selectedBridge===b.id ? '#a78bfa' : '#888', cursor:'pointer', fontSize:'0.85rem'}}>
                {b.name}
                <span style={{display:'block', fontSize:'0.7rem', color:'#555'}}>{b.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{marginBottom:'20px'}}>
        <div style={{color:'#888', fontSize:'0.85rem', marginBottom:'8px'}}>Amount (INIT)</div>
        <div style={{display:'flex', gap:'8px', alignItems:'center'}}>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
            style={{flex:1, padding:'12px 16px', borderRadius:'8px', background:'#0d1117',
              border:'1px solid #21262d', color:'#e2e8f0', fontSize:'1rem', outline:'none'}} />
          <span style={{color:'#888', fontSize:'0.9rem'}}>INIT</span>
        </div>
        <div style={{display:'flex', gap:'8px', marginTop:'8px'}}>
          {['0.1','0.5','1','5'].map(v => (
            <button key={v} onClick={() => setAmount(v)}
              style={{padding:'4px 10px', borderRadius:'6px', border:'1px solid #21262d',
                background:'#0d1117', color:'#888', cursor:'pointer', fontSize:'0.8rem'}}>{v}</button>
          ))}
        </div>
      </div>

      <div style={{background:'#0d1117', border:'1px solid #21262d', borderRadius:'8px', padding:'12px', marginBottom:'20px', fontSize:'0.85rem'}}>
        <div style={{display:'flex', alignItems:'center', gap:'12px', color:'#e2e8f0'}}>
          <span style={{color:'#888'}}>FROM</span>
          <span style={{fontFamily:'monospace'}}>{isDeposit ? 'Initia L1' : bridgeName}</span>
          <span style={{color:'#7c3aed', fontSize:'1.2rem'}}>→</span>
          <span style={{fontFamily:'monospace'}}>{isDeposit ? bridgeName : 'Initia L1'}</span>
          <span style={{color:'#888', marginLeft:'auto'}}>via OPinit</span>
        </div>
      </div>

      <button onClick={isDeposit ? handleDeposit : handleWithdraw} disabled={loading || !amount}
        style={{width:'100%', padding:'14px', borderRadius:'10px',
          background: loading ? '#1a1a2e' : 'linear-gradient(135deg,#7c3aed,#2563eb)',
          border:'none', color:'white', fontSize:'1rem', fontWeight:'600',
          cursor: loading ? 'not-allowed' : 'pointer', marginBottom:'16px'}}>
        {loading ? 'Processing...' : isDeposit
          ? 'Deposit ' + (amount||'0') + ' INIT → ' + bridgeName
          : 'Withdraw ' + (amount||'0') + ' INIT → Initia L1'}
      </button>

      {status && (
        <div style={{padding:'12px 16px', borderRadius:'8px', marginBottom:'16px',
          background: status.type==='error'?'#1a0a0a':status.type==='success'?'#0a1a0a':'#0a0a1a',
          border:'1px solid ' + (status.type==='error'?'#f8717144':status.type==='success'?'#00ff8844':'#3b82f644'),
          color: status.type==='error'?'#f87171':status.type==='success'?'#00ff88':'#93c5fd',
          fontSize:'0.85rem', lineHeight:'1.5'}}>
          {status.msg}
          {status.hash && (
            <a href={'https://scan.testnet.initia.xyz/initiation-2/txs/' + status.hash}
              target="_blank" rel="noreferrer"
              style={{display:'block', marginTop:'8px', color:'#7c3aed', textDecoration:'underline', fontSize:'0.8rem'}}>
              View on Explorer →
            </a>
          )}
        </div>
      )}

      <div style={{background:'#0d1117', border:'1px solid #21262d', borderRadius:'12px', padding:'16px', marginTop:'8px'}}>
        <div style={{color:'#888', fontSize:'0.8rem', marginBottom:'12px', fontWeight:'600', letterSpacing:'0.05em'}}>
          {isDeposit ? 'DEPOSIT FLOW' : 'WITHDRAWAL FLOW'}
        </div>
        {(isDeposit ? [
          ['1','Initiate','Lock INIT on L1 via MsgInitiateTokenDeposit'],
          ['2','Batch','OPinit relayer submits state batch to Celestia DA'],
          ['3','Finalize','After ~1hr, INIT arrives on your Minitia'],
          ['4','Use','Use INIT on the Minitia ecosystem'],
        ] : [
          ['1','Initiate','Call MsgInitiateTokenWithdrawal on Minitia'],
          ['2','Propose','Proposer submits output to Initia L1'],
          ['3','Finalize','After finalization period, INIT lands on L1'],
          ['4','Stream','Deposit into Fluvio vault and start streaming'],
        ]).map(([n, title, desc]) => (
          <div key={n} style={{display:'flex', gap:'12px', marginBottom:'10px', alignItems:'flex-start'}}>
            <div style={{width:'22px', height:'22px', borderRadius:'50%', background:'#1e1b4b',
              border:'1px solid #7c3aed', display:'flex', alignItems:'center', justifyContent:'center',
              color:'#a78bfa', fontSize:'0.75rem', flexShrink:0}}>{n}</div>
            <div>
              <div style={{color:'#e2e8f0', fontSize:'0.85rem', fontWeight:'500'}}>{title}</div>
              <div style={{color:'#555', fontSize:'0.8rem'}}>{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {pendingTxs.length > 0 && (
        <div style={{marginTop:'20px'}}>
          <div style={{color:'#888', fontSize:'0.8rem', marginBottom:'8px'}}>Recent Bridge Transactions</div>
          {pendingTxs.map((tx, i) => (
            <div key={i} style={{background:'#0d1117', border:'1px solid #21262d', borderRadius:'8px',
              padding:'10px 12px', marginBottom:'8px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div>
                <div style={{color:'#e2e8f0', fontSize:'0.85rem'}}>{tx.amount} INIT · {tx.type==='deposit'?'L1 → Minitia':'Minitia → L1'}</div>
                <div style={{color:'#555', fontSize:'0.75rem'}}>{new Date(tx.timestamp).toLocaleTimeString()}</div>
              </div>
              <a href={'https://scan.testnet.initia.xyz/initiation-2/txs/' + tx.hash}
                target="_blank" rel="noreferrer" style={{color:'#7c3aed', fontSize:'0.75rem', textDecoration:'none'}}>View →</a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
