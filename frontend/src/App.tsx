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
  const earned = (elapsedMs * stream.ratePerMs) / 1000
  return Math.min(stream.totalDeposited - stream.withdrawn, earned)
}

// Ecosystem ticker component
const EcosystemTicker = () => {
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
          const entriesRes = await fetch(`https://rest.testnet.initia.xyz/initia/move/v1/tables/${handle}/entries`)
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
          setTicker({
            blockTime: '100ms',
            flowRate: totalFlowRate.toFixed(6),
            activeStreams: activeStreams.length,
          })
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
      console.log("Stream created:", result)
        onSuccess?.()
      setStep('success')
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
type Tab = 'landing' | 'dashboard' | 'explore' | 'bridge'

export default function App() {
  const [tab, setTab] = useState<Tab>('landing')
  const [showCreate, setShowCreate] = useState(false)
  const { wallet, connect, disconnect } = useWallet()
  const { incomingStreams: realIncoming, outgoingStreams: realOutgoing, allStreams, refetch } = useStreams(wallet.hexAddress)
  const { withdrawStream, cancelStream } = useContract()
  const { sessionKey, sessionAddress, hasGrant, isGranting, enableSessionKey } = useSessionKey(wallet.address, grantSessionKey)
  const [withdrawnIds, setWithdrawnIds] = useState<Set<number>>(new Set())
  const [nowMs, setNowMs] = useState(Date.now())
  const [ticker, setTicker] = useState({ blockTime: '100ms', flowRate: '0.0000', activeStreams: 0 })
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 100)
    return () => clearInterval(interval)
  }, [])
  const [notification, setNotification] = useState<string | null>(null)

  const showNotif = (msg: string) => {
    setNotification(msg)
    setTimeout(() => setNotification(null), 3000)
  }

  const handleWithdraw = async (id: number) => {
    try {
      showNotif('Sending withdrawal transaction...')
      await withdrawStream(wallet.address, id, sessionKey?.mnemonic, sessionAddress || undefined)
      setWithdrawnIds(prev => new Set([...prev, id]))
      showNotif(`Withdrawal successful — INIT sent to ${wallet.username}`)
      setTimeout(() => refetch(), 3000)
    } catch (e: any) {
      showNotif('Withdrawal failed: ' + e.message)
    }
  }

  const handleCancel = async (id: number) => {
    try {
      showNotif('Cancelling stream...')
      await cancelStream(wallet.address, id)
      showNotif('Stream cancelled — unstreamed INIT returned to vault')
      setTimeout(() => refetch(), 3000)
    } catch (e: any) {
      showNotif('Cancel failed: ' + e.message)
    }
  }
  const now = nowMs
  const incomingStreams = realIncoming.map(s => ({
    ...s,
    claimable: claimableAmount(s, now),
  }))
  const outgoingStreams = realOutgoing.map(s => ({
    ...s,
    claimable: claimableAmount(s, now),
  }))

  if (tab === 'landing') {
    return (
      <div style={{fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,sans-serif",background:"#000",color:"#fff",minHeight:"100vh",overflowX:"hidden"}}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
          .lp-nav{position:fixed;top:0;width:100%;z-index:1000;background:rgba(0,0,0,0.8);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.1);padding:1rem 2.5rem;}
          .lp-nav-inner{max-width:1400px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;}
          .lp-logo{display:flex;align-items:center;gap:0.75rem;font-weight:700;font-size:1.25rem;color:#fff;}
          .lp-logo-icon{width:32px;height:32px;background:#fff;border-radius:6px;position:relative;flex-shrink:0;}
          .lp-logo-icon::before{content:'';width:14px;height:14px;background:#000;border-radius:2px;position:absolute;top:6px;left:6px;}
          .lp-logo-icon::after{content:'';width:8px;height:8px;background:#000;border-radius:2px;position:absolute;bottom:6px;right:6px;}
          .lp-nav-links{display:flex;gap:2.5rem;align-items:center;}
          .lp-nav-links a{color:#fff;text-decoration:none;font-size:0.95rem;font-weight:500;transition:color 0.3s;}
          .lp-nav-links a:hover{color:#10FF10;}
          .lp-launch-btn{background:#fff;color:#000;border:none;padding:0.6rem 1.5rem;border-radius:9999px;cursor:pointer;font-size:0.95rem;font-weight:600;transition:all 0.3s;font-family:inherit;}
          .lp-launch-btn:hover{background:#10FF10;color:#000;}
          .lp-hero{min-height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;position:relative;overflow:hidden;padding-top:60px;}
          .lp-hero-vid{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:100%;max-width:900px;z-index:1;pointer-events:none;}
          .lp-hero-content{position:relative;z-index:10;max-width:900px;padding:0 2rem;}
          .lp-badge{display:inline-flex;align-items:center;gap:0.5rem;background:rgba(16,255,16,0.1);border:1px solid rgba(16,255,16,0.3);color:#10FF10;padding:0.5rem 1rem;border-radius:9999px;font-size:0.8rem;font-weight:600;margin-bottom:2rem;letter-spacing:0.5px;}
          .lp-dot{width:8px;height:8px;background:#10FF10;border-radius:50%;animation:lp-pulse 2s infinite;}
          @keyframes lp-pulse{0%,100%{opacity:1}50%{opacity:0.5}}
          .lp-h1{font-size:5rem;font-weight:700;margin-bottom:0.5rem;line-height:1.1;color:#fff;letter-spacing:-3px;}
          .lp-sub{font-size:2rem;font-weight:500;color:#10FF10;margin-bottom:1.5rem;letter-spacing:-1px;}
          .lp-desc{font-size:1.1rem;color:rgba(255,255,255,0.7);margin-bottom:2.5rem;line-height:1.7;max-width:650px;margin-left:auto;margin-right:auto;}
          .lp-btns{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;margin-bottom:3rem;}
          .lp-btn-primary{background:#10FF10;color:#000;border:2px solid #10FF10;padding:1rem 2.5rem;border-radius:9999px;cursor:pointer;font-size:1rem;font-weight:700;transition:all 0.3s;font-family:inherit;}
          .lp-btn-primary:hover{background:#fff;border-color:#fff;transform:translateY(-2px);}
          .lp-btn-secondary{background:transparent;color:#fff;border:2px solid rgba(255,255,255,0.3);padding:1rem 2.5rem;border-radius:9999px;cursor:pointer;font-size:1rem;font-weight:600;transition:all 0.3s;font-family:inherit;text-decoration:none;display:inline-flex;align-items:center;}
          .lp-btn-secondary:hover{border-color:#10FF10;color:#10FF10;}
          .lp-ticker{display:flex;justify-content:center;gap:2rem;flex-wrap:wrap;padding:1.5rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;max-width:800px;margin:0 auto;}
          .lp-ticker-item{text-align:center;}
          .lp-ticker-label{font-size:0.7rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.25rem;}
          .lp-ticker-val{font-size:0.9rem;font-weight:600;color:#fff;font-family:'Courier New',monospace;}
          .lp-ticker-val.green{color:#10FF10;}
          .lp-stats{padding:6rem 2rem;text-align:center;background:#000;border-top:1px solid rgba(255,255,255,0.1);}
          .lp-stat-val{font-size:5rem;font-weight:700;color:#fff;font-family:'Courier New',monospace;letter-spacing:-3px;}
          .lp-stat-val .unit{color:#10FF10;font-size:3rem;}
          .lp-trusted{padding:4rem 2rem;text-align:center;border-top:1px solid rgba(255,255,255,0.05);}
          .lp-logos{display:flex;justify-content:center;align-items:center;gap:4rem;flex-wrap:wrap;}
          .lp-logo-item{font-size:1rem;font-weight:600;color:rgba(255,255,255,0.6);transition:color 0.3s;cursor:pointer;}
          .lp-logo-item:hover{color:#10FF10;}
          .lp-whatis{padding:8rem 2rem;background:#051a0f;border-top:1px solid rgba(255,255,255,0.1);}
          .lp-big-head{font-size:8rem;font-weight:700;line-height:1;letter-spacing:-4px;margin-bottom:4rem;}
          .lp-eyebrow{font-size:0.85rem;color:#10FF10;margin-bottom:1rem;font-weight:700;letter-spacing:1px;text-transform:uppercase;}
          .lp-section-h{font-size:3.5rem;font-weight:700;margin-bottom:1.5rem;color:#fff;line-height:1.2;letter-spacing:-2px;}
          .lp-body{color:rgba(255,255,255,0.7);font-size:1.1rem;line-height:1.8;max-width:700px;}
          .lp-body p{margin-bottom:1.5rem;}
          .lp-grid{display:grid;grid-template-columns:1fr 1fr;gap:4rem;margin-top:4rem;align-items:center;}
          .lp-visual{height:400px;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 50%,rgba(16,255,16,0.1) 0%,transparent 70%);border-radius:20px;overflow:hidden;}
          .lp-visual video{width:100%;height:100%;object-fit:contain;}
          .lp-comparison{padding:6rem 2rem;background:#000;border-top:1px solid rgba(255,255,255,0.1);}
          .lp-comparison h2{font-size:3rem;font-weight:700;margin-bottom:3rem;text-align:center;letter-spacing:-2px;}
          .lp-table{width:100%;border-collapse:collapse;font-size:0.95rem;}
          .lp-table th{text-align:left;padding:1.25rem 1.5rem;border-bottom:2px solid rgba(255,255,255,0.2);color:#888;font-weight:600;text-transform:uppercase;letter-spacing:1px;font-size:0.8rem;}
          .lp-table td{padding:1.25rem 1.5rem;border-bottom:1px solid rgba(255,255,255,0.05);color:rgba(255,255,255,0.8);}
          .lp-table tr:hover td{background:rgba(255,255,255,0.02);}
          .lp-table .hl{color:#10FF10;font-weight:600;}
          .lp-marquee-section{padding:5rem 2rem;background:#000;overflow:hidden;border-top:1px solid rgba(255,255,255,0.1);}
          .lp-marquee-wrap{overflow:hidden;margin:0 -2rem;}
          .lp-marquee{display:flex;gap:1rem;animation:lp-scroll 30s linear infinite;white-space:nowrap;padding:1rem 0;}
          @keyframes lp-scroll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
          .lp-marquee:hover{animation-play-state:paused;}
          .lp-marquee-item{padding:0.875rem 2rem;border:1px solid rgba(255,255,255,0.2);border-radius:50px;color:rgba(255,255,255,0.6);font-weight:500;font-size:0.95rem;flex-shrink:0;transition:all 0.3s;}
          .lp-marquee-item:hover{border-color:#10FF10;color:#10FF10;background:rgba(16,255,16,0.05);}
          .lp-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem;}
          .lp-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:2rem;transition:all 0.3s;}
          .lp-card:hover{border-color:rgba(16,255,16,0.3);transform:translateY(-4px);}
          .lp-card h3{font-size:1.25rem;font-weight:700;margin-bottom:1rem;color:#fff;}
          .lp-card p{color:#888;font-size:0.95rem;line-height:1.7;}
          .lp-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:2rem;}
          .lp-step{position:relative;padding:2rem;}
          .lp-step-num{font-size:4rem;font-weight:800;color:rgba(16,255,16,0.15);position:absolute;top:0;left:1rem;line-height:1;}
          .lp-step h3{font-size:1.1rem;font-weight:700;margin-bottom:1rem;margin-top:2rem;color:#fff;}
          .lp-step p{color:#888;font-size:0.9rem;line-height:1.7;}
          .lp-benefits{padding:6rem 2rem;background:#fff;color:#000;border-top:1px solid rgba(0,0,0,0.1);}
          .lp-benefits-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:200px 1fr;gap:4rem;align-items:start;}
          .lp-benefits-label{font-size:0.9rem;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:1px;padding-top:1rem;}
          .lp-benefits-h{font-size:3.5rem;font-weight:700;margin-bottom:2rem;letter-spacing:-2px;line-height:1.2;}
          .lp-hbox{background:#000;color:#10FF10;padding:0.2rem 1rem;border-radius:8px;display:inline;}
          .lp-benefit-row{padding:1.5rem 0;border-top:1px solid rgba(0,0,0,0.1);display:flex;align-items:center;gap:1rem;}
          .lp-benefit-row:last-child{border-bottom:1px solid rgba(0,0,0,0.1);}
          .lp-benefit-icon{width:40px;height:40px;background:#000;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#10FF10;font-size:1.2rem;flex-shrink:0;}
          .lp-benefit-text h4{font-size:1.1rem;font-weight:700;margin-bottom:0.25rem;}
          .lp-benefit-text p{color:#888;font-size:0.9rem;}
          .lp-gov{padding:8rem 2rem;background:#fff;color:#000;border-top:1px solid rgba(0,0,0,0.1);text-align:center;}
          .lp-gov-text{font-size:2.5rem;font-weight:500;line-height:1.4;margin-bottom:3rem;letter-spacing:-1px;max-width:1000px;margin-left:auto;margin-right:auto;}
          .lp-token-badge{display:inline-flex;align-items:center;justify-content:center;background:#000;color:#10FF10;padding:0.3rem 1rem;border-radius:8px;font-weight:700;font-size:2rem;vertical-align:middle;margin:0 0.3rem;}
          .lp-gov-btn{display:inline-flex;align-items:center;gap:0.5rem;background:#000;color:#10FF10;padding:1rem 2.5rem;border-radius:9999px;text-decoration:none;font-weight:600;font-size:1rem;transition:all 0.3s;border:none;cursor:pointer;font-family:inherit;}
          .lp-gov-btn:hover{background:#10FF10;color:#000;}
          .lp-footer{background:#fff;color:#000;padding:4rem 2rem 2rem;border-top:1px solid rgba(0,0,0,0.1);}
          .lp-footer-big{font-size:15vw;font-weight:900;line-height:0.9;letter-spacing:-0.05em;color:#000;margin-bottom:4rem;overflow:hidden;}
          .lp-footer-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:3rem;margin-bottom:3rem;padding-top:3rem;border-top:1px solid rgba(0,0,0,0.1);}
          .lp-footer-grid h4{color:#000;font-size:0.9rem;margin-bottom:1.5rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;}
          .lp-footer-links{display:flex;flex-direction:column;gap:0.875rem;}
          .lp-footer-links a{color:#888;text-decoration:none;transition:color 0.3s;font-size:0.95rem;}
          .lp-footer-links a:hover{color:#000;}
          .lp-footer-bottom{display:flex;justify-content:space-between;align-items:center;padding-top:2rem;border-top:1px solid rgba(0,0,0,0.1);font-size:0.9rem;color:#888;}
          @media(max-width:968px){.lp-grid,.lp-benefits-inner{grid-template-columns:1fr;gap:2rem;}.lp-cards{grid-template-columns:repeat(2,1fr);}.lp-steps{grid-template-columns:repeat(2,1fr);}.lp-footer-grid{grid-template-columns:repeat(2,1fr);}.lp-h1{font-size:3.5rem;}.lp-big-head{font-size:4rem;}.lp-section-h{font-size:2.5rem;}.lp-stat-val{font-size:3rem;}}
          @media(max-width:640px){.lp-h1{font-size:2.5rem;}.lp-sub{font-size:1.5rem;}.lp-big-head{font-size:3rem;}.lp-cards,.lp-steps{grid-template-columns:1fr;}.lp-footer-grid{grid-template-columns:1fr;}.lp-footer-big{font-size:20vw;}}
        `}</style>

        {/* Nav */}
        <nav className="lp-nav">
          <div className="lp-nav-inner">
            <div className="lp-logo"><div className="lp-logo-icon"></div><span>Fluvio</span></div>
            <div className="lp-nav-links">
              <a href="#technology">Technology</a>
              <a href="#builders">Builders</a>
              <a href="#adoptions">Adoptions</a>
              <a href="#governance">Governance</a>
              <button className="lp-launch-btn" onClick={() => setTab('dashboard')}>Launch App</button>
            </div>
          </div>
        </nav>

        {/* Hero */}
        <section className="lp-hero">
          <div className="lp-hero-vid">
            <video autoPlay muted loop playsInline style={{width:'100%',height:'auto',display:'block'}}>
              <source src="https://superfluid.org/hero-fluid.webm" type="video/webm" />
            </video>
          </div>
          <div className="lp-hero-content">
            <div className="lp-badge"><div className="lp-dot"></div>Live on Initia Testnet · initiation-2</div>
            <h1 className="lp-h1">Money Flows, Not Moves.</h1>
            <div className="lp-sub">Earn Every Millisecond</div>
            <p className="lp-desc">Fluvio is the first money streaming protocol built natively on Initia. Real on-chain state every 100 milliseconds. Send salaries, subscriptions, grants, and rentals by the millisecond — to any .init username, from any chain.</p>
            <div className="lp-btns">
              <button className="lp-btn-primary" onClick={() => setTab('dashboard')}>Start Streaming →</button>
              <a className="lp-btn-secondary" href="https://scan.testnet.initia.xyz/initiation-2/accounts/init17g5nnyjfkhnjg4w2m82m9st6lxdhuw62zjgsmd" target="_blank" rel="noreferrer">View Contract on Explorer</a>
            </div>
            <div className="lp-ticker">
              <div className="lp-ticker-item"><div className="lp-ticker-label">Block Time</div><div className="lp-ticker-val green">100ms</div></div>
              <div className="lp-ticker-item"><div className="lp-ticker-label">Network</div><div className="lp-ticker-val">initiation-2</div></div>
              <div className="lp-ticker-item"><div className="lp-ticker-label">Global Flow Rate</div><div className="lp-ticker-val green">{ticker?.flowRate || "0.0000"} INIT/sec</div></div>
              <div className="lp-ticker-item"><div className="lp-ticker-label">Active Streams</div><div className="lp-ticker-val">{ticker?.activeStreams || "0"}</div></div>
              <div className="lp-ticker-item"><div className="lp-ticker-label">Contract Block</div><div className="lp-ticker-val">#22041965</div></div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="lp-stats">
          <div style={{maxWidth:'900px',margin:'0 auto',textAlign:'center'}}>
            <div style={{color:'#888',fontSize:'0.85rem',marginBottom:'1rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'2px'}}>Powering</div>
            <div className="lp-stat-val">{ticker?.flowRate || "0.0000"} <span className="unit">INIT/sec</span></div>
            <div style={{color:'rgba(255,255,255,0.7)',fontSize:'1.1rem',margin:'1rem 0 2rem'}}>flowing continuously, every 100 milliseconds, on Initia testnet</div>
            <div style={{color:'#888',fontSize:'1rem',lineHeight:1.8,maxWidth:'700px',margin:'0 auto 1.5rem'}}>Fluvio's smart contracts are live on initiation-2, deployed at block #22041965. Every active stream updates real on-chain state 10 times per second — not client-side JavaScript math.</div>
            <div style={{fontFamily:'Courier New',fontSize:'0.75rem',color:'#888',wordBreak:'break-all'}}>TX: 21D7D1326DA445B2AE9843FC2DE05B9F9BD457FF760EB7BD55E5DAA07106CE64</div>
          </div>
        </section>

        {/* Trusted */}
        <section className="lp-trusted">
          <h3 style={{color:'#888',fontSize:'0.85rem',marginBottom:'2.5rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'2px'}}>Built natively with Initia's full technology stack</h3>
          <div className="lp-logos">
            {['Initia Labs','InterwovenKit','.init Usernames','Interwoven Bridge','Move VM'].map(l=><div key={l} className="lp-logo-item">{l}</div>)}
          </div>
        </section>

        {/* What is */}
        <section className="lp-whatis" id="technology">
          <div style={{maxWidth:'1400px',margin:'0 auto'}}>
            <div className="lp-big-head"><span style={{color:'#fff'}}>What is</span><br/><span style={{color:'#10FF10'}}>Fluvio</span></div>
            <div className="lp-eyebrow">01 — 03 · The Protocol</div>
            <h2 className="lp-section-h">Real streaming. Not a simulation.</h2>
            <div className="lp-body">
              <p>Fluvio is Initia's native money streaming protocol. Instead of sending 1,000 INIT in a single lump transaction, you deposit into a Fluvio vault and define a flow rate. The contract streams to the recipient every 100 milliseconds.</p>
              <p>The recipient's claimable balance grows every single block. They can withdraw at any moment — mid-stream, without cancelling.</p>
            </div>
            <div className="lp-grid" style={{marginTop:'6rem'}}>
              <div>
                <div className="lp-eyebrow">02 — 03 · The Advantage</div>
                <h2 className="lp-section-h">Superfluid fakes it. We don't.</h2>
                <div className="lp-body"><p>Superfluid calculates your balance client-side using JavaScript. The Ethereum blockchain sees nothing between 12-second blocks. On Fluvio, timestamp::now_milliseconds() returns a value that changes every 100ms — because Initia produces a block every 100ms. The state is real.</p></div>
              </div>
              <div className="lp-visual"><video autoPlay muted loop playsInline><source src="https://superfluid.org/sup-coin-2.webm" type="video/webm"/></video></div>
            </div>
          </div>
        </section>

        {/* Comparison */}
        <section className="lp-comparison">
          <div style={{maxWidth:'1200px',margin:'0 auto'}}>
            <h2>Fluvio vs Superfluid</h2>
            <table className="lp-table">
              <thead><tr><th>Feature</th><th>Superfluid (Ethereum)</th><th>Fluvio (Initia)</th></tr></thead>
              <tbody>
                {[
                  ['Block time','12 seconds','100 milliseconds'],
                  ['Streaming reality','Off-chain JavaScript math','Real on-chain state every block'],
                  ['Stream creation gas','$5–20 on mainnet','Fractions of a cent'],
                  ['Wallet UX','New popup for every action','Sign once, stream for 30 days'],
                  ['Cross-chain','Multiple bridges, complex setup','Interwoven Bridge — one click'],
                  ['Recipient identity','0x hex addresses','.init human-readable usernames'],
                  ['Public oracle','No','Yes — stream_registry.move'],
                ].map(([f,s,fl])=><tr key={f}><td>{f}</td><td>{s}</td><td className="hl">{fl}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>

        {/* Possibilities */}
        <section className="lp-marquee-section" id="builders">
          <div style={{maxWidth:'1200px',margin:'0 auto'}}>
            <h2 style={{fontSize:'2.5rem',marginBottom:'0.5rem',fontWeight:700,letterSpacing:'-1px'}}>Possibilities</h2>
            <p style={{color:'#888',fontSize:'1.1rem',marginBottom:'3rem'}}>With Fluvio, earning onchain becomes a completely novel experience</p>
          </div>
          <div className="lp-marquee-wrap">
            <div className="lp-marquee">
              {['Get paid by the second','Stream salaries','Subscribe by the millisecond','Rent cloud infrastructure','Dollar-cost average automatically','Stream developer grants','Pay per API call','Cross-chain streaming','Real-time creator royalties','Micro-payment channels','Stream game rewards','DAO contributor pay','Vesting schedules','Stream yield distribution','Get paid by the second','Stream salaries','Subscribe by the millisecond','Rent cloud infrastructure','Dollar-cost average automatically','Stream developer grants'].map((t,i)=><div key={i} className="lp-marquee-item">{t}</div>)}
            </div>
          </div>
        </section>

        {/* Use Cases */}
        <section style={{padding:'6rem 2rem',background:'#000',borderTop:'1px solid rgba(255,255,255,0.1)'}} id="adoptions">
          <div style={{maxWidth:'1200px',margin:'0 auto'}}>
            <h2 style={{fontSize:'3rem',fontWeight:700,marginBottom:'3rem',textAlign:'center',letterSpacing:'-2px'}}>Use Cases</h2>
            <div className="lp-cards">
              {[
                ['Real-time Payroll','Replace monthly salary runs with continuous streams. Employees receive INIT every millisecond they work.'],
                ['Subscriptions','Stream subscription fees. Subscribers cancel at any moment and the unstreamed portion returns instantly.'],
                ['Infrastructure Rental','Pay for servers and compute by the millisecond. The moment you stop your stream, payment stops.'],
                ['Protocol Grants','Stream grants to developers. Grant funds flow continuously — aligned with ongoing contribution.'],
                ['Gaming Rewards','Every second a player spends in a game, INIT flows into their .init wallet. True play-to-earn.'],
                ['Cross-chain Streaming','Deposit from Ethereum via Interwoven Bridge. Start streaming immediately to any .init address.'],
              ].map(([t,d])=><div key={t} className="lp-card"><h3>{t}</h3><p>{d}</p></div>)}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section style={{padding:'6rem 2rem',background:'#000',borderTop:'1px solid rgba(255,255,255,0.1)'}}>
          <div style={{maxWidth:'1200px',margin:'0 auto'}}>
            <h2 style={{fontSize:'3rem',fontWeight:700,marginBottom:'3rem',textAlign:'center',letterSpacing:'-2px'}}>How It Works</h2>
            <div className="lp-steps">
              {[
                ['01','Connect Your .init Wallet','Open Fluvio and connect with Keplr. Your streaming identity is human-readable — not a hex string.'],
                ['02','Deposit INIT to Your Vault','Deposit INIT from your wallet. Coming from another chain? Use the Interwoven Bridge directly in the app.'],
                ['03','Create a Stream','Enter the recipient .init username, amount, and duration. Approve once with a session key.'],
                ['04','Watch Money Flow','Your dashboard shows every stream with a live counter ticking every 100ms.'],
              ].map(([n,t,d])=><div key={n} className="lp-step"><div className="lp-step-num">{n}</div><h3>{t}</h3><p>{d}</p></div>)}
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="lp-benefits">
          <div className="lp-benefits-inner">
            <div className="lp-benefits-label">Benefits</div>
            <div>
              <h2 className="lp-benefits-h"><span className="lp-hbox">Fluvio enables</span> the top crypto-native organizations to manage recurring payments like airdrops, salaries and grants.</h2>
              <div>
                {[
                  ['⚡','Genuinely Real-time','Initia 100ms block time means claimable_amount() returns a different value every tenth of a second.'],
                  ['✍️','Sign Once, Stream Forever','You approve a stream once, one wallet signature, and it runs automatically for the entire duration.'],
                  ['👤','.init Identity Layer','Streaming to alice.init feels human. Fluvio uses Initia .init username system for all streams.'],
                  ['🌐','Interwoven Bridge Native','Deposit from Ethereum, Cosmos, or any Interwoven-connected chain directly in the Fluvio UI.'],
                  ['📡','Ecosystem Oracle','stream_registry.move is a public good. Any smart contract can call get_global_flow_rate().'],
                  ['💰','Appchain Economics','Near-zero gas costs. Micro-streams of $0.001/hr are economically viable on Fluvio.'],
                ].map(([icon,t,d])=>(
                  <div key={t} className="lp-benefit-row">
                    <div className="lp-benefit-icon">{icon}</div>
                    <div className="lp-benefit-text"><h4>{t}</h4><p>{d}</p></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Governance */}
        <section className="lp-gov" id="governance">
          <div className="lp-gov-text">Every time you use apps in our ecosystem rewards campaign, you earn <span className="lp-token-badge">INIT</span> ecosystem tokens. Use your rewards to help govern the Fluvio protocol.</div>
          <button className="lp-gov-btn" onClick={() => setTab('dashboard')}>Launch App →</button>
        </section>

        {/* Footer */}
        <footer className="lp-footer">
          <div style={{maxWidth:'1400px',margin:'0 auto'}}>
            <div className="lp-footer-big">Fluvio</div>
            <div className="lp-footer-grid">
              <div><h4>Protocol</h4><div className="lp-footer-links"><a href="#">Governance</a><a href="#">Docs</a><a href="#">Explorer</a><a href="#">Dashboard</a></div></div>
              <div><h4>Resources</h4><div className="lp-footer-links"><a href="#">Blog</a><a href="#">Media Kit</a></div></div>
              <div><h4>Community</h4><div className="lp-footer-links"><a href="#">X</a><a href="#">Discord</a></div></div>
              <div><h4>Legal</h4><div className="lp-footer-links"><a href="#">Privacy Policy</a><a href="#">Terms of use</a></div></div>
            </div>
            <div className="lp-footer-bottom"><span>© 2026 The Fluvio Foundation</span><span>Built on Initia · initiation-2 testnet</span></div>
          </div>
        </footer>
      </div>
    )
  }

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
      <EcosystemTicker />
      {notification && <div className="notification">{notification}</div>}

      <main className="main">
        {tab === 'dashboard' && (
          <>
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-value">{wallet.balance}</div><div className="stat-label">Your Balance (INIT)</div></div>
              <div className="stat-card"><div className="stat-value">0.0015</div><div className="stat-label">Global Flow Rate (INIT/sec)</div></div>
              <div className="stat-card"><div className="stat-value">3</div><div className="stat-label">Active Streams</div></div>
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
                      <span className="stream-sender">{stream.senderUsername}</span>
                    </div>
                    <div className="stream-amount">
                      <span className="amount-value">{stream.claimable.toFixed(4)} INIT</span>
                      <span className="amount-label">claimable</span>
                    </div>
                    <div className="stream-progress">
                      <div className="progress-bar" style={{width: `${(stream.claimable / stream.totalDeposited) * 100}%`}} />
                    </div>
                    <button className="btn-withdraw" onClick={() => handleWithdraw(stream.id)}>Withdraw</button>
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
                      <span className="stream-recipient">{stream.recipientUsername}</span>
                    </div>
                    <div className="stream-amount">
                      <span className="amount-value">{stream.claimable.toFixed(4)} INIT</span>
                      <span className="amount-label">streamed so far</span>
                    </div>
                    <div className="stream-progress">
                      <div className="progress-bar" style={{width: `${(stream.claimable / stream.totalDeposited) * 100}%`}} />
                    </div>
                    <button className="btn-cancel" onClick={() => handleCancel(stream.id)}>Cancel</button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        {tab === 'explore' && (
          <div className="explore-container">
            <h2 style={{color:'var(--accent)',fontFamily:'var(--font-mono)',marginBottom:'0.5rem'}}>
              Live Streams on Initia
            </h2>
            <p style={{color:'var(--text-secondary)',marginBottom:'2rem',fontSize:'0.9rem'}}>
              {allStreams.length} stream{allStreams.length !== 1 ? 's' : ''} on-chain · Contract: init17g5...zjgsmd
            </p>
            <div style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
              {allStreams.length === 0 ? (
                <p style={{color:'var(--text-secondary)'}}>No streams found on chain yet.</p>
              ) : (
                allStreams.map(stream => (
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
/* 
*/
