import React, { useState, useEffect, useCallback } from 'react'
import './App.css'
import { useWallet } from './useWallet'
import { useStreams } from './useStreams'
import { useContract, initializeVault, grantSessionKey } from './useContract'
import { useSessionKey } from './hooks/useSessionKey'
import { BridgeTab } from './BridgeTab.jsx'

// Types
interface Stream {
  id: number
  sender: string
  recipient: string
  senderUsername: string
  recipientUsername: string
  totalDeposited: number
  ratePerMs: number
  withdrawn: number
  startTimeMs: number
  endTimeMs: number
  streamType: 'salary' | 'subscription' | 'rental' | 'grant' | 'custom'
  note: string
  active: boolean
  cancelled: boolean
}

// Mock streams (will be replaced with real data later)
const DEMO_START = Date.now() - 3 * 24 * 60 * 60 * 1000
const DEMO_END = Date.now() + 11 * 24 * 60 * 60 * 1000

const MOCK_STREAMS: Stream[] = [
  {
    id: 1,
    sender: 'initia-labs.init',
    recipient: 'shahmeer.init',
    senderUsername: 'initia-labs.init',
    recipientUsername: 'shahmeer.init',
    totalDeposited: 1400,
    ratePerMs: 1400 / (14 * 24 * 60 * 60 * 1000),
    withdrawn: 0,
    startTimeMs: DEMO_START,
    endTimeMs: DEMO_END,
    streamType: 'salary',
    note: 'Monthly Developer Grant',
    active: true,
    cancelled: false,
  },
  {
    id: 2,
    sender: 'drip.init',
    recipient: 'shahmeer.init',
    senderUsername: 'drip.init',
    recipientUsername: 'shahmeer.init',
    totalDeposited: 500,
    ratePerMs: 500 / (30 * 24 * 60 * 60 * 1000),
    withdrawn: 0,
    startTimeMs: Date.now() - 5 * 24 * 60 * 60 * 1000,
    endTimeMs: Date.now() + 25 * 24 * 60 * 60 * 1000,
    streamType: 'subscription',
    note: 'Protocol Revenue Share',
    active: true,
    cancelled: false,
  },
]

const MOCK_OUTGOING: Stream[] = [
  {
    id: 3,
    sender: 'shahmeer.init',
    recipient: 'alice.init',
    senderUsername: 'shahmeer.init',
    recipientUsername: 'alice.init',
    totalDeposited: 300,
    ratePerMs: 300 / (30 * 24 * 60 * 60 * 1000),
    withdrawn: 0,
    startTimeMs: Date.now() - 2 * 24 * 60 * 60 * 1000,
    endTimeMs: Date.now() + 28 * 24 * 60 * 60 * 1000,
    streamType: 'rental',
    note: 'Server Rental',
    active: true,
    cancelled: false,
  },
]

// Helper: calculate claimable amount for a stream
function claimableAmount(stream: Stream, nowMs: number): number {
  if (!stream.active || stream.cancelled) return 0
  const effectiveEnd = Math.min(stream.endTimeMs, nowMs)
  if (effectiveEnd <= stream.startTimeMs) return 0
  const elapsedMs = effectiveEnd - stream.startTimeMs
  // ratePerMs from chain is stored as (actual_rate_uinit_per_ms * 1000)
  // In useStreams we do: ratePerMs = rate_per_ms / 1_000_000 (convert uinit to INIT)
  // But we need to also divide by 1000 for the x1000 precision multiplier
  // So actual rate in INIT/ms = chain_rate_per_ms / 1000 / 1_000_000
  // earned INIT = elapsedMs * chain_rate / 1000 / 1_000_000
  // Since ratePerMs = chain_rate / 1_000_000, earned = elapsedMs * ratePerMs / 1000
  const earned = elapsedMs * stream.ratePerMs
  return Math.min(stream.totalDeposited - stream.withdrawn, earned)
}

// Ecosystem ticker component
const EcosystemTicker = ({ onUpdate }: { onUpdate: (t: any) => void }) => {
  const [ticker, setTicker] = useState({ blockTime: '100ms', flowRate: '0.0000', activeStreams: 0 })
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('https://rest.testnet.initia.xyz/initia/move/v1/accounts/0xf229399249b5e72455cad9d5b2c17af99b7e3b4a/resources')
        const data = await res.json()
        const registry = data.resources?.find((r: any) => r.struct_tag.includes('stream_core::StreamRegistry'))
        if (registry) {
          const parsed = JSON.parse(registry.move_resource)
          const handle = parsed.data.streams.handle
          const entriesRes = await fetch(`https://rest.testnet.initia.xyz/initia/move/v1/tables/${handle}/entries?limit=1000`)
          const entriesData = await entriesRes.json()
          const activeStreams = (entriesData.table_entries || []).filter((e: any) => {
            const s = JSON.parse(e.value)
            return s.active === true && !s.cancelled
          })
          const totalFlowRate = activeStreams.reduce((sum: number, e: any) => {
            const s = JSON.parse(e.value)
            const rate = parseInt(s.rate_per_ms || '0')
            return sum + (rate / 1000 / 1_000_000) * 1000 // per second in INIT
          }, 0)
          const t = { blockTime: '100ms', flowRate: totalFlowRate.toFixed(6), activeStreams: activeStreams.length }
          setTicker(t)
          onUpdate(t)
        }
      } catch {}
    }
    fetchStats()
    const interval = setInterval(fetchStats, 5000)
    return () => clearInterval(interval)
  }, [])
  return (
    <div className="ecosystem-ticker">
      <div className="ticker-item">⚡ Block time: {ticker.blockTime}</div>
      <div className="ticker-item">💧 Global flow: {ticker.flowRate} INIT/sec</div>
      <div className="ticker-item">🌊 Active streams: {ticker.activeStreams}</div>
    </div>
  )
}

// Create Stream Modal
function CreateStreamForm({ onClose, senderAddress, onSuccess }: { onClose: () => void; senderAddress: string; onSuccess?: () => void }) {
  const { createStream, withdrawStream, cancelStream } = useContract()
  const [form, setForm] = useState({
    recipient: '',
    amount: '',
    duration: '30',
    durationUnit: 'days',
    streamType: 'salary',
    note: '',
  })
  const [step, setStep] = useState<'form' | 'confirm' | 'success'>('form')
  const [loading, setLoading] = useState(false)

  const durationMs = () => {
    const n = parseFloat(form.duration)
    const units: Record<string, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }
    return n * (units[form.durationUnit] || 86_400_000)
  }

  const ratePerSec = () => {
    const ms = durationMs()
    if (!ms || !form.amount) return 0
    return (parseFloat(form.amount) / ms) * 1000
  }

  const handleCreate = async () => {
    setLoading(true)
    try {
      const amountUinit = Math.floor(parseFloat(form.amount) * 1_000_000)
      // Check if vault exists first to avoid double popup
        const vaultCheck = await fetch(
          `https://rest.testnet.initia.xyz/initia/move/v1/accounts/${senderAddress}/resources`
        ).catch(() => null)
        const vaultData = vaultCheck ? await vaultCheck.json() : null
        const vaultExists = vaultData?.resources?.some((r: any) =>
          r.struct_tag.includes('stream_vault')
        )
        if (!vaultExists) {
          await initializeVault(senderAddress)
          await new Promise(r => setTimeout(r, 3000))
        }
        const result = await createStream(senderAddress, form.recipient, amountUinit, durationMs(), 0, form.note || '', senderAddress.slice(0,10) + '.init', form.recipient.slice(0,10) + '.init')
      setStep('success')
      setTimeout(() => onSuccess?.(), 2000)
      setTimeout(() => onSuccess?.(), 5000)
    } catch (err: any) {
      alert('Failed: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  if (step === 'success') {
    return (
      <div className="modal-overlay">
        <div className="modal success-modal">
          <div className="success-icon">✓</div>
          <div className="success-title">Stream created</div>
          <div className="success-sub">
            Streaming {form.amount} INIT to {form.recipient} over {form.duration} {form.durationUnit}
          </div>
          <button className="btn-primary" onClick={onClose}>Back to dashboard</button>
        </div>
      </div>
    )
  }

  if (step === 'confirm') {
    return (
      <div className="modal-overlay">
        <div className="modal">
          <div className="modal-title">Confirm stream</div>
          <div className="confirm-row"><span>Recipient</span><span>{form.recipient}</span></div>
          <div className="confirm-row"><span>Amount</span><span>{form.amount} INIT</span></div>
          <div className="confirm-row"><span>Duration</span><span>{form.duration} {form.durationUnit}</span></div>
          <div className="confirm-row highlight"><span>Rate</span><span>{ratePerSec().toFixed(6)} INIT/sec</span></div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setStep('form')}>Back</button>
            <button className="btn-primary" onClick={handleCreate} disabled={loading}>
              {loading ? 'Signing...' : 'Sign & Create Stream'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">New stream</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <input placeholder="Recipient .init address" value={form.recipient} onChange={e => setForm({...form, recipient: e.target.value})} />
          <input placeholder="Amount (INIT)" type="number" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} />
          <div className="duration-row">
            <input type="number" value={form.duration} onChange={e => setForm({...form, duration: e.target.value})} style={{width: '80px'}} />
            <select value={form.durationUnit} onChange={e => setForm({...form, durationUnit: e.target.value})}>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </div>
          <select value={form.streamType} onChange={e => setForm({...form, streamType: e.target.value as any})}>
            <option value="salary">Salary</option>
            <option value="subscription">Subscription</option>
            <option value="rental">Rental</option>
            <option value="grant">Grant</option>
          </select>
          <textarea placeholder="Note (optional)" value={form.note} onChange={e => setForm({...form, note: e.target.value})} />
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => setStep('confirm')}>Continue</button>
        </div>
      </div>
    </div>
  )
}

// Main App
type Tab = 'dashboard' | 'explore' | 'bridge'

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [showCreate, setShowCreate] = useState(false)
  const [tickerData, setTickerData] = useState({ blockTime: '100ms', flowRate: '0.0000', activeStreams: 0 })
  const { wallet, connect, disconnect, refreshBalance } = useWallet()
  const { incomingStreams: realIncoming, outgoingStreams: realOutgoing, allStreams, refetch } = useStreams(wallet.hexAddress)
  const { withdrawStream, cancelStream } = useContract()
  const { sessionKey, sessionAddress, hasGrant, isGranting, enableSessionKey } = useSessionKey(wallet.address, grantSessionKey)
  const [withdrawnIds, setWithdrawnIds] = useState<Set<number>>(new Set())
  const [withdrawingIds, setWithdrawingIds] = useState<Set<number>>(new Set())
  const [cancelledIds, setCancelledIds] = useState<Set<number>>(new Set())
  const [cancellingIds, setCancellingIds] = useState<Set<number>>(new Set())
  const [nowMs, setNowMs] = useState(Date.now())
  const [exploreFilter, setExploreFilter] = useState<'all'|'live'|'ended'>('live')
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 100)
    return () => clearInterval(interval)
  }, [])
  // Auto-refresh balance every 30 seconds
  useEffect(() => {
    if (!wallet.connected) return
    const interval = setInterval(() => refreshBalance(), 30000)
    return () => clearInterval(interval)
  }, [wallet.connected, refreshBalance])

  const [notification, setNotification] = useState<string | null>(null)

  const showNotif = (msg: string) => {
    setNotification(msg)
    setTimeout(() => setNotification(null), 3000)
  }

  const handleWithdraw = async (id: number) => {
    setWithdrawingIds(prev => new Set([...prev, id]))
    try {
      showNotif('Sending withdrawal transaction...')
      await withdrawStream(wallet.address, id, sessionKey?.mnemonic, sessionAddress || undefined)
      setWithdrawnIds(prev => new Set([...prev, id]))
      showNotif(`✅ Withdrawal successful — INIT sent to your wallet!`)
      setTimeout(() => refreshBalance(), 2000)
      setTimeout(() => refetch(), 2000)
    } catch (e: any) {
      showNotif('Withdrawal failed: ' + e.message)
    } finally {
      setWithdrawingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  const handleCancel = async (id: number) => {
    setCancellingIds(prev => new Set([...prev, id]))
    try {
      showNotif('Cancelling stream...')
      await cancelStream(wallet.address, id)
      setCancelledIds(prev => new Set([...prev, id]))
      showNotif('✅ Stream cancelled — unstreamed INIT returned to vault')
      setTimeout(() => refreshBalance(), 2000)
    } catch (e: any) {
      showNotif('Cancel failed: ' + e.message)
    } finally {
      setCancellingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }
  const now = nowMs
  const incomingStreams = realIncoming
    .map(s => ({ ...s, claimable: claimableAmount(s, now) }))
    .filter(s => s.active && !s.cancelled && !withdrawnIds.has(s.id) && now < s.endTimeMs)
  const outgoingStreams = realOutgoing
    .filter(s => !cancelledIds.has(s.id) && s.active)
    .map(s => ({ ...s, claimable: claimableAmount(s, now) }))

  return (
    <div className="app">
      <div className="bg-grid" />
      <header className="header">
        <div className="logo">
          <div className="logo-mark"><div className="logo-wave" /></div>
          <span className="logo-text">Fluvio</span>
          <span className="logo-tag">on Initia</span>
        </div>
        <nav className="nav">
          <button className={`nav-btn ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>Dashboard</button>
          <button className={`nav-btn ${tab === 'explore' ? 'active' : ''}`} onClick={() => setTab('explore')}>Explore</button>
          <button className={`nav-btn ${tab === 'bridge' ? 'active' : ''}`} onClick={() => setTab('bridge')}>Bridge</button>
          
        </nav>
        <div className="header-right">
          {wallet.connected ? (
            <div className="wallet-connected">
              <div className="wallet-dot" />
              <span>{wallet.username || wallet.address.slice(0,10)+'...'}</span>
              <span style={{color:"#00ff88", fontSize:"0.8rem"}}>{wallet.balance} INIT</span>
              <button className="btn-disconnect" onClick={disconnect}>Disconnect</button>
              {hasGrant ? (
                <span style={{color:"#00ff88", fontSize:"0.75rem", padding:"4px 8px", border:"1px solid #00ff8844", borderRadius:"6px"}}>⚡ Session Active</span>
              ) : (
                <button
                  className="btn-session"
                  onClick={enableSessionKey}
                  disabled={isGranting || !wallet.connected}
                  style={{fontSize:"0.75rem", padding:"4px 10px", background:"#1a1a2e", border:"1px solid #7c3aed", borderRadius:"6px", color:"#a78bfa", cursor:"pointer"}}
                >
                  {isGranting ? 'Enabling...' : '⚡ Enable Session Key'}
                </button>
              )}
            </div>
          ) : (
            <button className="btn-connect" onClick={connect}>Connect .init</button>
          )}
        </div>
      </header>
      <EcosystemTicker onUpdate={setTickerData} />
      {notification && <div className="notification">{notification}</div>}

      <main className="main">
        {tab === 'dashboard' && !wallet.connected && (
          <div className="hero">
            <div className="hero-badge">⚡ Built on Initia</div>
            <h1 className="hero-title">Stream money<br/>in real time</h1>
            <p className="hero-sub">Fluvio lets you stream INIT token per second — like a salary, subscription, or grant. Fully on-chain, trustless, instant.</p>
            <div className="hero-stats">
              <div className="hero-stat"><div className="hero-stat-value">{tickerData.activeStreams}</div><div className="hero-stat-label">Active Streams</div></div>
              <div className="hero-stat"><div className="hero-stat-value">{tickerData.flowRate}</div><div className="hero-stat-label">INIT/sec Flowing</div></div>
              <div className="hero-stat"><div className="hero-stat-value">100ms</div><div className="hero-stat-label">Block Time</div></div>
            </div>
            <button className="hero-cta" onClick={connect}>Connect Wallet to Start</button>
            <div className="hero-features">
              <div className="hero-feature">
                <div className="hero-feature-icon">◈</div>
                <div><strong>Real-time payments</strong><p>Money flows every millisecond, not every month. No batches, no delays.</p></div>
              </div>
              <div className="hero-feature">
                <div className="hero-feature-icon">⌘</div>
                <div><strong>Session keys</strong><p>Sign once to authorize a session key. Streams run automatically without wallet popups.</p></div>
              </div>
              <div className="hero-feature">
                <div className="hero-feature-icon">⇄</div>
                <div><strong>Interwoven bridge</strong><p>Move INIT between Initia L1 and Minitias via the native OPinit bridge.</p></div>
              </div>
            </div>
          </div>
        )}
        {tab === 'dashboard' && wallet.connected && (
          <>
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-value">{wallet.balance}</div><div className="stat-label">Your Balance (INIT)</div></div>
              <div className="stat-card"><div className="stat-value">{tickerData.flowRate}</div><div className="stat-label">Global Flow Rate (INIT/sec)</div></div>
              <div className="stat-card"><div className="stat-value">{tickerData.activeStreams}</div><div className="stat-label">Active Streams</div></div>
            </div>

            <div className="streams-section">
              <div className="section-header">
                <h2>Incoming streams</h2>
              </div>
              <div className="streams-list">
                {incomingStreams.map(stream => (
                  <div key={stream.id} className="stream-card">
                    <div className="stream-header">
                      <span className="stream-type" data-type={stream.streamType}>{stream.streamType}</span>
                      <span style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
                        <span className="stream-live-dot" />
                        <span style={{fontSize:'0.75rem',color:'var(--accent)',fontWeight:700}}>LIVE</span>
                      </span>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:'0.75rem'}}>
                      <div>
                        <div style={{fontSize:'0.7rem',color:'var(--text-muted)',marginBottom:'0.2rem',textTransform:'uppercase',letterSpacing:'0.08em'}}>From</div>
                        <div style={{fontSize:'0.9rem',fontFamily:'var(--mono)',color:'#fff'}}>{stream.senderUsername}</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:'0.7rem',color:'var(--text-muted)',marginBottom:'0.2rem',textTransform:'uppercase',letterSpacing:'0.08em'}}>Rate</div>
                        <div style={{fontSize:'0.9rem',fontFamily:'var(--mono)',color:'var(--accent)',fontWeight:700}}>{(stream.ratePerMs * 1000).toFixed(4)} INIT/sec</div>
                      </div>
                    </div>
                    <div className="stream-amount">
                      <span className="amount-value">{stream.claimable.toFixed(6)} INIT</span>
                      <span className="amount-label">claimable</span>
                    </div>
                    <div className="stream-progress">
                      <div className="progress-bar" style={{width: `${Math.min(100,(stream.claimable / stream.totalDeposited) * 100)}%`}} />
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'0.75rem'}}>
                      <span style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>
                        {stream.totalDeposited.toFixed(4)} INIT total · {nowMs < stream.endTimeMs ? `${Math.ceil((stream.endTimeMs - nowMs) / 60000)}min left` : 'Ended'}
                      </span>
                      <button className="btn-withdraw" onClick={() => handleWithdraw(stream.id)} disabled={withdrawingIds.has(stream.id)}>{withdrawingIds.has(stream.id) ? "Withdrawing..." : "Withdraw"}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="streams-section">
              <div className="section-header">
                <h2>Outgoing streams</h2>
                <button className="btn-new-stream" onClick={() => setShowCreate(true)}>+ New stream</button>
              </div>
              <div className="streams-list">
                {outgoingStreams.map(stream => (
                  <div key={stream.id} className="stream-card">
                    <div className="stream-header">
                      <span className="stream-type" data-type={stream.streamType}>{stream.streamType}</span>
                      <span style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
                        <span className="stream-live-dot" style={{background:'var(--amber)'}} />
                        <span style={{fontSize:'0.75rem',color:'var(--amber)',fontWeight:700}}>SENDING</span>
                      </span>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:'0.75rem'}}>
                      <div>
                        <div style={{fontSize:'0.7rem',color:'var(--text-muted)',marginBottom:'0.2rem',textTransform:'uppercase',letterSpacing:'0.08em'}}>To</div>
                        <div style={{fontSize:'0.9rem',fontFamily:'var(--mono)',color:'#fff'}}>{stream.recipientUsername}</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:'0.7rem',color:'var(--text-muted)',marginBottom:'0.2rem',textTransform:'uppercase',letterSpacing:'0.08em'}}>Rate</div>
                        <div style={{fontSize:'0.9rem',fontFamily:'var(--mono)',color:'var(--amber)',fontWeight:700}}>{(stream.ratePerMs * 1000).toFixed(4)} INIT/sec</div>
                      </div>
                    </div>
                    <div className="stream-amount">
                      <span className="amount-value" style={{color:'var(--amber)'}}>{stream.claimable.toFixed(6)} INIT</span>
                      <span className="amount-label">streamed so far</span>
                    </div>
                    <div className="stream-progress">
                      <div className="progress-bar" style={{width: `${Math.min(100,(stream.claimable / stream.totalDeposited) * 100)}%`, background:'linear-gradient(90deg,#d97706,#f59e0b)'}} />
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'0.75rem'}}>
                      <span style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>
                        {stream.totalDeposited.toFixed(4)} INIT total · {nowMs < stream.endTimeMs ? `${Math.ceil((stream.endTimeMs - nowMs) / 60000)}min left` : 'Ended'}
                      </span>
                      <button className="btn-cancel" onClick={() => handleCancel(stream.id)} disabled={cancellingIds.has(stream.id)}>{cancellingIds.has(stream.id) ? "Cancelling..." : "Cancel"}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        {tab === 'explore' && (
          <div className="explore-container">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:'2rem',flexWrap:'wrap',gap:'1rem'}}>
              <div>
                <h2 style={{color:'var(--accent)',fontFamily:'var(--font-mono)',marginBottom:'0.25rem',fontSize:'1.5rem',fontWeight:800}}>Live Streams</h2>
                <p style={{color:'var(--text-muted)',fontSize:'0.85rem'}}>
                  {allStreams.filter(s=>s.active).length} live · {allStreams.length} total · Contract: init17g5...zjgsmd
                </p>
              </div>
              <div style={{display:'flex',gap:'0.5rem'}}>
                {['all','live','ended'].map(f => (
                  <button key={f} onClick={()=>setExploreFilter(f as any)} style={{
                    padding:'0.4rem 1rem',borderRadius:'9999px',border:'1px solid',
                    borderColor: exploreFilter===f ? 'var(--accent)' : 'var(--border)',
                    background: exploreFilter===f ? 'rgba(16,255,16,0.1)' : 'transparent',
                    color: exploreFilter===f ? 'var(--accent)' : 'var(--text-muted)',
                    fontSize:'0.8rem',fontWeight:700,cursor:'pointer',fontFamily:'var(--font)',
                    textTransform:'capitalize',transition:'all 0.2s'
                  }}>{f}</button>
                ))}
              </div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
              {allStreams.filter(s => exploreFilter === 'all' ? true : exploreFilter === 'live' ? s.active : !s.active).length === 0 ? (
                <p style={{color:'var(--text-muted)',textAlign:'center',padding:'3rem'}}>No streams found.</p>
              ) : (
                allStreams.filter(s => exploreFilter === 'all' ? true : exploreFilter === 'live' ? s.active : !s.active).map(stream => (
                  <div key={stream.id} style={{
                    background:'rgba(0,255,136,0.03)',
                    border:'1px solid rgba(0,255,136,0.1)',
                    borderRadius:'12px',
                    padding:'1.5rem',
                  }}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.8rem'}}>
                      <span style={{
                        background:'rgba(0,255,136,0.15)',
                        color:'var(--accent)',
                        padding:'2px 10px',
                        borderRadius:'20px',
                        fontSize:'0.75rem',
                        fontWeight:700,
                        textTransform:'uppercase',
                        fontFamily:'var(--font-mono)',
                      }}>{stream.streamType}</span>
                      <span style={{color: stream.active ? 'var(--accent)' : 'var(--text-secondary)', fontSize:'0.8rem'}}>
                        {stream.active ? '● LIVE' : '○ ENDED'}
                      </span>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:'0.85rem',color:'var(--text-secondary)'}}>
                      <span>FROM: <span style={{color:'var(--text-primary)',fontFamily:'var(--font-mono)'}}>{stream.senderUsername}</span></span>
                      <span>TO: <span style={{color:'var(--text-primary)',fontFamily:'var(--font-mono)'}}>{stream.recipientUsername}</span></span>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',marginTop:'0.8rem',fontSize:'0.85rem'}}>
                      <span style={{color:'var(--accent)',fontFamily:'var(--font-mono)',fontWeight:700}}>
                        {(stream.ratePerMs * 1000).toFixed(6)} INIT/sec
                      </span>
                      <span style={{color:'var(--text-secondary)'}}>
                        Total: {stream.totalDeposited.toFixed(4)} INIT
                      </span>
                    </div>
                    <div style={{marginTop:'0.8rem',background:'rgba(0,255,136,0.05)',borderRadius:'4px',height:'4px'}}>
                      <div style={{
                        background:'var(--accent)',
                        height:'100%',
                        borderRadius:'4px',
                        width: `${Math.min(100, ((Date.now() - stream.startTimeMs) / (stream.endTimeMs - stream.startTimeMs)) * 100)}%`,
                        transition:'width 0.5s ease',
                      }}/>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',marginTop:'0.4rem',fontSize:'0.75rem',color:'var(--text-secondary)'}}>
                      <span>Stream #{stream.id}</span>
                      <span>{Math.min(100, ((Date.now() - stream.startTimeMs) / (stream.endTimeMs - stream.startTimeMs)) * 100).toFixed(1)}% complete</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        {tab === 'bridge' && (
          <BridgeTab walletAddress={wallet.address} onSuccess={refetch} />
        )}
      </main>
      {showCreate && <CreateStreamForm onClose={() => setShowCreate(false)} senderAddress={wallet.address} onSuccess={refetch} />}
    </div>
  )
}
