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
  const [copied, setCopied] = useState(false)
  const [showShare, setShowShare] = useState(false)

  const siteUrl = 'https://monad-gas-tracker.vercel.app'
  const shortAddr = `${addr.slice(0, 6)}...${addr.slice(-4)}`

  const viralText = `${tier.emoji} I've spent ${monFormatted} MON on gas on @moaboratory!\n\nStatus: ${tier.label}\n${sentCount} verified transactions\n\nHow degen are you? Check yours 👇\n${siteUrl}`

  const twitterText = `${tier.emoji} I've burned ${monFormatted} $MON on gas on @monad_xyz!\n\nMy status: ${tier.label}\n📊 ${sentCount} txs verified on-chain\n\nAre you more degen than me? Find out 👇\n${siteUrl}\n\n#Monad #MonadGas #Degen #Web3`

  const handleCopy = () => {
    navigator.clipboard.writeText(viralText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const shareTwitter = () => {
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(twitterText)}`, '_blank')
  }

  const shareTelegram = () => {
    window.open(`https://t.me/share/url?url=${encodeURIComponent(siteUrl)}&text=${encodeURIComponent(viralText)}`, '_blank')
  }

  const shareWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(viralText)}`, '_blank')
  }

  const shareWarpcast = () => {
    window.open(`https://warpcast.com/~/compose?text=${encodeURIComponent(viralText)}`, '_blank')
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

      {/* ── Share Section ── */}
      <div className="share-section">
        <div className="share-label">Share your degen status</div>
        <div className="share-buttons">
          <button className="share-btn share-twitter" onClick={shareTwitter} title="Share on X (Twitter)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            <span>X / Twitter</span>
          </button>
          <button className="share-btn share-warpcast" onClick={shareWarpcast} title="Share on Warpcast">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3.09 1.41L5.59 9.67H18.41L20.91 1.41H24L20.11 14.7H16.5L15.46 22.59H8.54L7.5 14.7H3.89L0 1.41H3.09Z"/></svg>
            <span>Warpcast</span>
          </button>
          <button className="share-btn share-telegram" onClick={shareTelegram} title="Share on Telegram">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
            <span>Telegram</span>
          </button>
          <button className="share-btn share-whatsapp" onClick={shareWhatsApp} title="Share on WhatsApp">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            <span>WhatsApp</span>
          </button>
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn-ghost" onClick={() => window.open(`${CONFIG.explorerUrl}/address/${addr}`, '_blank')}>Explorer ↗</button>
        <button className="btn-primary-sm" onClick={handleCopy}>{copied ? '✓ Copied!' : 'Copy Result'}</button>
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
