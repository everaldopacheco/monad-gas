import { useState, useCallback } from 'react'
import { Ripple } from '@/components/ui/ripple'
import './App.css'

// ═══════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════
const CONFIG = {
  rpcs: ['https://rpc.monad.xyz', 'https://monad-mainnet.drpc.org'],
  socialScanApi: 'https://api.socialscan.io/rest/monad-mainnet/v1/explorer',
  explorerUrl: 'https://monadscan.com',
  corsProxies: [
    u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
  ],
  pageSize: 100,
}

// ═══════════════════════════════════════════════
//  DETERMINISTIC MATH
// ═══════════════════════════════════════════════
function monStringToWei(monStr) {
  if (!monStr || monStr === '0') return 0n
  const parts = monStr.split('.')
  const whole = parts[0] || '0'
  let frac = parts[1] || '0'
  frac = frac.padEnd(18, '0').slice(0, 18)
  return BigInt(whole) * (10n ** 18n) + BigInt(frac)
}

function weiToMonFormatted(wei) {
  const divisor = 10n ** 18n
  const whole = wei / divisor
  const frac = wei % divisor
  const fracStr = frac.toString().padStart(18, '0').slice(0, 2)
  return `${whole.toLocaleString('en-US')}.${fracStr}`
}

function weiToMonFloat(wei) {
  const divisor = 10n ** 18n
  const whole = wei / divisor
  const frac = wei % divisor
  return parseFloat(`${whole}.${frac.toString().padStart(18, '0')}`)
}

// ═══════════════════════════════════════════════
//  TIERS
// ═══════════════════════════════════════════════
const TIERS = [
  { min: 10, cls: 'tier-fire', label: '🔥 ABSOLUTE DEGEN', emoji: '🔥', title: 'Legendary Status', msg: 'The network is powered by your activity.' },
  { min: 5, cls: 'tier-fire', label: '🚀 ULTRA DEGEN', emoji: '🚀', title: 'Ultra Degen', msg: 'Incredible gas usage recorded.' },
  { min: 1, cls: 'tier-legend', label: '💜 OFFICIAL DEGEN', emoji: '💜', title: 'Degen confirmed', msg: 'You keep the ecosystem spinning.' },
  { min: 0.1, cls: 'tier-gold', label: '⚡ ACTIVE', emoji: '⚡', title: 'Active Player', msg: 'Consistent network contribution.' },
  { min: 0.01, cls: 'tier-silver', label: '🌀 EXPLORING', emoji: '🌀', title: 'Explorer', msg: 'Carefully exploring the chain.' },
  { min: 0.001, cls: 'tier-bronze', label: '🐾 STARTING', emoji: '🐾', title: 'Early Steps', msg: 'Your journey has begun.' },
  { min: 0, cls: 'tier-newbie', label: '🐣 NEWBIE', emoji: '🐣', title: 'Welcome', msg: 'Curiosity starts here.' },
]

function getTier(mon) {
  for (const t of TIERS) if (mon >= t.min) return t
  return TIERS[TIERS.length - 1]
}

// ═══════════════════════════════════════════════
//  FETCH
// ═══════════════════════════════════════════════
async function fetchJSON(url) {
  const sep = url.includes('?') ? '&' : '?'
  const fullUrl = `${url}${sep}_t=${Date.now()}`
  try {
    const res = await fetch(fullUrl, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache, no-store' } })
    if (res.ok) return await res.json()
  } catch (_) {}
  for (const proxyFn of CONFIG.corsProxies) {
    try {
      const res = await fetch(proxyFn(fullUrl), { headers: { Accept: 'application/json' } })
      if (!res.ok) continue
      const data = await res.json()
      if (data && data.contents) return JSON.parse(data.contents)
      return data
    } catch (_) {}
  }
  throw new Error('All fetch attempts failed')
}

async function rpcCall(method, params) {
  for (const rpc of CONFIG.rpcs) {
    try {
      const res = await fetch(rpc, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
      const data = await res.json()
      if (data?.result !== undefined) return data.result
    } catch (_) {}
  }
  return null
}

async function scanFullHistory(addr, onProgress) {
  const addrLow = addr.toLowerCase()
  let totalWei = 0n, sentCount = 0, page = 1
  const seenHashes = new Set()
  while (true) {
    onProgress(`Scanning page ${page}… (${sentCount} sent txs)`)
    const data = await fetchJSON(`${CONFIG.socialScanApi}/address/${addr}/transactions?page=${page}&size=${CONFIG.pageSize}`)
    const list = data?.data || []
    if (!Array.isArray(list) || list.length === 0) break
    for (const tx of list) {
      if (seenHashes.has(tx.hash)) continue
      seenHashes.add(tx.hash)
      if ((tx.from_address || '').toLowerCase() !== addrLow) continue
      totalWei += monStringToWei(tx.total_transaction_fee || tx.transaction_fee || '0')
      sentCount++
    }
    if (list.length < CONFIG.pageSize) break
    page++
    if (page > 500) break
  }
  return { totalWei, sentCount }
}

// ═══════════════════════════════════════════════
//  COMPONENTS
// ═══════════════════════════════════════════════

function LoadingModal({ status }) {
  return (
    <div className="modal-loading">
      <div className="spinner" />
      <div className="loading-label">Full History Scan</div>
      <div className="loading-status">{status}</div>
    </div>
  )
}

function ResultModal({ result, onClose }) {
  const { addr, totalWei, monFormatted, sentCount, nonce, integrity, tier } = result

  const handleCopy = () => {
    navigator.clipboard.writeText(
      `I've spent ${monFormatted} MON on gas on Monad!\n${tier.emoji} ${tier.title}\n\nCheck yours at Monad Gas Tracker`
    )
  }

  return (
    <div className="modal-result">
      <div className="result-label">Deterministic Analysis</div>
      <div className="wallet-display">{addr}</div>
      <div className="gas-block">
        <div className="gas-label">Total Gas Spent</div>
        <div className="gas-value">{monFormatted} <span>MON</span></div>
        <div className="gas-meta">{totalWei.toLocaleString('en-US')} wei</div>
        <div className={`tier-badge ${tier.cls}`}>{tier.label}</div>
      </div>
      <div className="message-card">
        <span className="message-emoji">{tier.emoji}</span>
        <div className="message-text">{tier.title}</div>
        <div className="message-sub">{tier.msg}</div>
      </div>
      <div className="stats-row">
        <div className="stat-box">
          <div className="stat-key">Txs Verified</div>
          <div className={`stat-val ${!integrity ? 'warn-text' : ''}`}>{sentCount}</div>
        </div>
        <div className="stat-box">
          <div className="stat-key">On-chain Nonce</div>
          <div className="stat-val">{nonce}</div>
        </div>
      </div>
      {!integrity && <div className="integrity-warn">⚠ Explorer is still indexing some recent transactions.</div>}
      <div className="modal-actions">
        <button className="btn-ghost" onClick={() => window.open(`${CONFIG.explorerUrl}/address/${addr}`, '_blank')}>Explorer ↗</button>
        <button className="btn-primary-sm" onClick={handleCopy}>Copy Result</button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
//  APP
// ═══════════════════════════════════════════════
export default function App() {
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [result, setResult] = useState(null)

  const isAddress = (v) => /^0x[0-9a-fA-F]{40}$/.test(v.trim())

  const startSearch = useCallback(async () => {
    const addr = address.trim()
    setError('')
    if (!isAddress(addr)) { setError('⚠ Invalid address.'); return }

    setLoading(true)
    setModalOpen(true)
    setResult(null)

    try {
      setLoadingStatus('Verifying on-chain nonce…')
      const nonceHex = await rpcCall('eth_getTransactionCount', [addr, 'latest'])
      const nonce = nonceHex ? parseInt(nonceHex, 16) : 0

      const { totalWei, sentCount } = await scanFullHistory(addr, setLoadingStatus)
      const monFormatted = weiToMonFormatted(totalWei)
      const monFloat = weiToMonFloat(totalWei)
      const tier = getTier(monFloat)
      const integrity = sentCount >= nonce

      setResult({ addr, totalWei, monFormatted, sentCount, nonce, integrity, tier })
    } catch (err) {
      setModalOpen(false)
      setError('⚠ Failed to complete scan. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [address])

  const handleKeyDown = (e) => { if (e.key === 'Enter') startSearch() }

  return (
    <div className="app-root">
      {/* ── Magic UI Ripple Background ── */}
      <div className="ripple-bg">
        <Ripple mainCircleSize={210} mainCircleOpacity={0.18} numCircles={10} />
      </div>

      {/* ── Main Content ── */}
      <div className="wrapper">
        <div className="logo-area">
          <div className="logo-dot" />
          <span className="logo-text">Monad Mainnet · Chain 143</span>
        </div>

        <h1>Gas <span>Tracker</span></h1>
        <p className="subtitle">// how much gas have you spent since block 0?</p>

        <div className="network-pill">
          <span className="nl" />
          monad mainnet · live
        </div>

        <div className="search-area">
          <div className="input-row">
            <div className="input-wrap">
              <input
                id="walletInput"
                type="text"
                placeholder="0x..."
                spellCheck="false"
                autoComplete="off"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>
            <button className="btn-search" id="searchBtn" disabled={loading} onClick={startSearch}>
              {loading ? '...' : 'Search'}
            </button>
          </div>
          <p className="error-msg">{error}</p>
        </div>

        <div className="hint-row">
          <span className="hint-chip"><span className="dot" />Gas tracked since genesis block</span>
          <span className="hint-chip"><span className="dot" />Data via SocialScan + RPC</span>
          <span className="hint-chip"><span className="dot" />Result in MON</span>
        </div>
      </div>

      {/* ── Modal ── */}
      {modalOpen && (
        <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div className="modal">
            <button className="modal-close" onClick={() => setModalOpen(false)}>✕</button>
            <div id="modalContent">
              {loading ? <LoadingModal status={loadingStatus} /> : result && <ResultModal result={result} onClose={() => setModalOpen(false)} />}
            </div>
          </div>
        </div>
      )}

      <footer className="site-footer">
        Built by <a href="https://x.com/everaldoSRN" target="_blank" rel="noopener noreferrer">everaldo.mon</a>
      </footer>
    </div>
  )
}
