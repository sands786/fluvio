import { useState, useEffect, useCallback } from 'react'

export interface OnChainStream {
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

const HEX = '0xc809333033602fea438a4917dd1890d0f3eb8851'

function streamTypeFromIndex(idx: number): OnChainStream['streamType'] {
  const types: OnChainStream['streamType'][] = ['salary', 'subscription', 'rental', 'grant', 'custom']
  return types[idx] || 'custom'
}

function decodeHexStr(hex: string): string {
  try {
    if (!hex || hex === '0x') return ''
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex
    const bytes = new Uint8Array(clean.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
    return new TextDecoder().decode(bytes)
  } catch { return '' }
}

async function fetchAllStreams(): Promise<OnChainStream[]> {
  const regRes = await fetch(
    `https://rest.testnet.initia.xyz/initia/move/v1/accounts/${HEX}/resources`
  )
  const regData = await regRes.json()
  const registryResource = regData.resources?.find((r: any) =>
    r.struct_tag.includes('stream_core::StreamRegistry')
  )
  if (!registryResource) return []

  const registryData = JSON.parse(registryResource.move_resource)
  const tableHandle = registryData.data.streams.handle

  const entriesRes = await fetch(
    `https://rest.testnet.initia.xyz/initia/move/v1/tables/${tableHandle}/entries?limit=1000`
  )
  const entriesData = await entriesRes.json()

  return (entriesData.table_entries || []).map((entry: any) => {
    const s = JSON.parse(entry.value)
    const totalDeposited = parseInt(s.total_deposited || '0')
    const startMs = parseInt(s.start_time_ms || '0')
    const endMs = parseInt(s.end_time_ms || '0')
    const durationMs = endMs - startMs
    const ratePerMs = durationMs > 0 ? totalDeposited / durationMs : 0

    return {
      id: parseInt(s.id || entry.key.replace(/"/g, '')),
      sender: s.sender?.toLowerCase() || '',
      recipient: s.recipient?.toLowerCase() || '',
      senderUsername: decodeHexStr(s.sender_username) || s.sender?.slice(0, 12) + '...',
      recipientUsername: decodeHexStr(s.recipient_username) || s.recipient?.slice(0, 12) + '...',
      totalDeposited: totalDeposited / 1_000_000,
      ratePerMs: parseInt(s.rate_per_ms || '0') / 1_000_000_000, // chain stores rate*1000 uinit/ms, convert to INIT/ms
      withdrawn: parseInt(s.withdrawn_by_recipient || '0') / 1_000_000,
      startTimeMs: startMs,
      endTimeMs: endMs,
      streamType: streamTypeFromIndex(parseInt(s.stream_type || '0')),
      note: decodeHexStr(s.note) || '',
      active: s.active === true,
      cancelled: s.cancelled === true,
    }
  })
}

export function useStreams(walletHexAddress: string) {
  const [incomingStreams, setIncomingStreams] = useState<OnChainStream[]>([])
  const [outgoingStreams, setOutgoingStreams] = useState<OnChainStream[]>([])
  const [allStreams, setAllStreams] = useState<OnChainStream[]>([])
  const [loading, setLoading] = useState(false)

  const fetchStreams = useCallback(async () => {
    setLoading(true)
    try {
      const streams = await fetchAllStreams()
      setAllStreams(streams)
      console.log('All streams:', streams)
      console.log('Filtering by hex:', walletHexAddress)

      if (walletHexAddress) {
        const hex = walletHexAddress.toLowerCase()
        console.log('Stream sample:', streams[0]?.sender, streams[0]?.recipient)
        setIncomingStreams(streams.filter(s => s.recipient?.toLowerCase() === hex))
        setOutgoingStreams(streams.filter(s => s.sender?.toLowerCase() === hex))
      }
    } catch (e) {
      console.error('Failed to fetch streams:', e)
    } finally {
      setLoading(false)
    }
  }, [walletHexAddress])

  useEffect(() => {
    fetchStreams()
    const interval = setInterval(fetchStreams, 10000)
    return () => clearInterval(interval)
  }, [fetchStreams])

  return { incomingStreams, outgoingStreams, allStreams, loading, refetch: fetchStreams }
}

export async function getClaimableAmount(stream: OnChainStream): number {
  const now = Date.now()
  const elapsed = Math.min(now, stream.endTimeMs) - stream.startTimeMs
  if (elapsed <= 0) return 0
  // rate_per_ms is stored x1000 for precision
  const earned = (elapsed * stream.ratePerMs) 
  return Math.max(0, earned - stream.withdrawn)
}
