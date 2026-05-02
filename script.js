// ═══════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════
const CONFIG = {
  // Public RPC endpoints — Monad mainnet chain 143
  rpcs: [
    'https://monad-mainnet.drpc.org',
    'https://monad.drpc.org',
    'https://rpc.ankr.com/monad_mainnet',
  ],
  // MonadScan (Etherscan-compatible)
  monadScanApi: 'https://api.monadscan.com/api',
  // Etherscan V2 with Monad chainid
  etherscanV2Api: 'https://api.etherscan.io/v2/api',
  monadChainId: '143',
  explorerUrl: 'https://monadscan.com',
  // SocialScan
  socialScanApi: 'https://api.socialscan.io/monad/v1/explorer/command_api',
  // CORS proxies (tried in order for each request)
  corsProxies: [
    u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    u => `https://proxy.cors.sh/${u}`,
  ],
  maxPages: 50,
  pageSize: 10000,
  socialScanPageSize: 25, // SocialScan often has smaller limits
};

// ═══════════════════════════════════════════════
//  TIER SYSTEM
// ═══════════════════════════════════════════════
const TIERS = [
  {
    min: 10,
    cls: 'tier-fire',
    label: '🔥 ABSOLUTE DEGEN',
    emoji: '🔥',
    title: 'You are a living legend on Monad!',
    msg: 'Over 10 MON in gas? You don\'t use the network — you ARE the network. Absolute degen, Monad owes you a monument.',
    sub: 'Top 0.1% gas spenders'
  },
  {
    min: 5,
    cls: 'tier-fire',
    label: '🚀 ULTRA DEGEN',
    emoji: '🚀',
    title: 'Congrats, you\'re a true degen!',
    msg: 'You went too far and nobody stopped you. Monad recorded every single wei with love.',
    sub: 'Level: Ultra degen'
  },
  {
    min: 1,
    cls: 'tier-legend',
    label: '💜 OFFICIAL DEGEN',
    emoji: '💜',
    title: 'Degen status confirmed by the network.',
    msg: 'You\'ve made things happen on Monad. Wallets like yours keep the ecosystem spinning. Respect.',
    sub: 'Well above average'
  },
  {
    min: 0.1,
    cls: 'tier-gold',
    label: '⚡ ACTIVE & CONSISTENT',
    emoji: '⚡',
    title: 'You\'re in the game!',
    msg: 'Not the biggest degen, but well on your way. Keep going — the ecosystem needs active players like you.',
    sub: 'Above average'
  },
  {
    min: 0.01,
    cls: 'tier-silver',
    label: '🌀 EXPLORING',
    emoji: '🌀',
    title: 'Warming up the engines...',
    msg: 'You\'re exploring Monad carefully. Nothing wrong with that — every degen starts this way.',
    sub: 'Explorer profile'
  },
  {
    min: 0.001,
    cls: 'tier-bronze',
    label: '🐾 JUST STARTING',
    emoji: '🐾',
    title: 'First steps on Monad!',
    msg: 'You showed up, made a few transactions, and you\'re here checking. The beginning of a great degen journey.',
    sub: 'Early adopter in training'
  },
  {
    min: 0,
    cls: 'tier-newbie',
    label: '🐣 NEWBIE',
    emoji: '🐣',
    title: 'Welcome to the ecosystem!',
    msg: 'You just arrived and you\'re already checking your gas. Curiosity is the first step. Monad awaits you.',
    sub: 'Journey started'
  },
];

function getTier(mon) {
  for (const t of TIERS) if (mon >= t.min) return t;
  return TIERS[TIERS.length - 1];
}

// ═══════════════════════════════════════════════
//  UTILITIES & NORMALIZATION
// ═══════════════════════════════════════════════
function isAddress(v) {
  return /^0x[0-9a-fA-F]{40}$/.test(v.trim());
}

function shortAddr(addr) {
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

/**
 * Ensures all transaction objects from different sources are uniform.
 */
function normalizeTx(tx) {
  return {
    hash:              tx.hash || tx.txHash || tx.transactionHash || '',
    from:              (tx.from || tx.from_address || '').toLowerCase(),
    to:                (tx.to || tx.to_address || '').toLowerCase(),
    gasUsed:           String(tx.gasUsed  || tx.gas_used  || '0'),
    gasPrice:          String(tx.gasPrice || tx.gas_price || '0'),
    effectiveGasPrice: String(tx.effectiveGasPrice || tx.effective_gas_price || tx.gasPrice || tx.gas_price || '0'),
    blockNumber:       String(tx.blockNumber || tx.block_number || '0'),
  };
}

function weiToMon(weiStr) {
  if (!weiStr || weiStr === '0') return 0;
  try {
    const n = BigInt(weiStr);
    if (n === 0n) return 0;
    const divisor = 10n ** 18n;
    const whole   = n / divisor;
    const frac    = n % divisor;
    const fracStr = frac.toString().padStart(18, '0');
    return parseFloat(whole.toString() + '.' + fracStr);
  } catch (e) {
    console.error('BigInt conversion error for weiStr:', weiStr, e);
    return 0;
  }
}

function formatMon(val) {
  if (val === 0) return '0.000000';
  if (val < 0.0000001) return val.toExponential(4) + ' (< 0.0000001)';
  if (val < 0.000001)  return val.toFixed(10);
  if (val < 0.001)     return val.toFixed(8);
  if (val < 1)         return val.toFixed(6);
  if (val < 1000)      return val.toFixed(4);
  return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatTxCount(n) {
  return n.toLocaleString('en-US');
}

// ═══════════════════════════════════════════════
//  MODAL & UI
// ═══════════════════════════════════════════════
function openModal(html) {
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');
  if (content && overlay) {
    content.innerHTML = html;
    overlay.classList.add('open');
  }
}

function closeModal() {
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.classList.remove('open');
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

const walletInput = document.getElementById('walletInput');
if (walletInput) {
  walletInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') startSearch();
  });
}

function setLoadingStatus(msg) {
  const el = document.getElementById('loadingStatus');
  if (el) el.textContent = msg;
}

function showLoading(addr) {
  openModal(`
    <div class="modal-loading">
      <div class="spinner"></div>
      <div class="loading-label">Fetching on-chain data...</div>
      <div class="loading-status" id="loadingStatus">Initializing connection...</div>
    </div>
  `);
}

// ═══════════════════════════════════════════════
//  CORS-AWARE FETCH LAYER
// ═══════════════════════════════════════════════
function raceTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Request timed out')), ms))
  ]);
}

async function parseRes(res, proxyFn) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (proxyFn && proxyFn('x').includes('allorigins')) {
    try {
      const wrapper = JSON.parse(text);
      if (wrapper.contents !== undefined) return JSON.parse(wrapper.contents);
    } catch (_) {}
  }
  return JSON.parse(text);
}

async function fetchJSON(url, ms = 15000) {
  try {
    const res = await raceTimeout(fetch(url, { headers: { Accept: 'application/json' } }), ms);
    return await parseRes(res, null);
  } catch (_) {}

  for (const proxyFn of CONFIG.corsProxies) {
    try {
      const proxied = proxyFn(url);
      const res = await raceTimeout(fetch(proxied, { headers: { Accept: 'application/json' } }), ms);
      return await parseRes(res, proxyFn);
    } catch (_) {}
  }

  throw new Error(`Connection failed. The API might be down or blocked.`);
}

async function fetchPost(url, body, ms = 8000) {
  try {
    const res = await raceTimeout(fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    }), ms);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (_) {
    return null;
  }
}

async function rpcCall(method, params) {
  const body = { jsonrpc: '2.0', id: 1, method, params };
  for (const rpc of CONFIG.rpcs) {
    try {
      const data = await fetchPost(rpc, body);
      if (data && data.result !== undefined) return data.result;
    } catch (_) {}
  }
  return null;
}

// ═══════════════════════════════════════════════
//  GAS CALCULATION
// ═══════════════════════════════════════════════
function txGasWei(tx) {
  try {
    const gasUsed = BigInt(tx.gasUsed || '0');
    if (gasUsed === 0n) return 0n;
    const gasPrice = BigInt(tx.effectiveGasPrice || tx.gasPrice || '0');
    return gasUsed * gasPrice;
  } catch (e) {
    console.error('Error calculating gas for tx:', tx.hash, e);
    return 0n;
  }
}

function calcTotalGas(txs, address) {
  const addrLow = address.toLowerCase();
  let totalWei = 0n;
  let sentCount = 0;

  for (const tx of txs) {
    if (tx.from !== addrLow) continue;
    const cost = txGasWei(tx);
    totalWei += cost;
    sentCount++;
  }
  return { totalWei, sentCount };
}

// ═══════════════════════════════════════════════
//  DATA SOURCES
// ═══════════════════════════════════════════════
async function fetchMonadScan(address, onProgress) {
  let allTxs = [];
  let page = 1;

  while (page <= CONFIG.maxPages) {
    onProgress(`MonadScan · Page ${page}…`);
    const url = `${CONFIG.monadScanApi}?module=account&action=txlist&address=${address}&startblock=0&endblock=latest&page=${page}&offset=${CONFIG.pageSize}&sort=asc`;

    const data = await fetchJSON(url);
    if (!data || data.status === '0') break;
    if (data.status === '1' && Array.isArray(data.result)) {
      const normalized = data.result.map(normalizeTx);
      allTxs = allTxs.concat(normalized);
      if (data.result.length < CONFIG.pageSize) break;
      page++;
    } else {
      break;
    }
  }
  return allTxs.length > 0 ? allTxs : null;
}

async function fetchEtherscanV2(address, onProgress) {
  let allTxs = [];
  let page = 1;

  while (page <= CONFIG.maxPages) {
    onProgress(`Etherscan V2 · Page ${page}…`);
    const url = `${CONFIG.etherscanV2Api}?chainid=${CONFIG.monadChainId}&module=account&action=txlist&address=${address}&startblock=0&endblock=latest&page=${page}&offset=${CONFIG.pageSize}&sort=asc`;

    const data = await fetchJSON(url);
    if (!data || data.status === '0') break;
    if (data.status === '1' && Array.isArray(data.result)) {
      const normalized = data.result.map(normalizeTx);
      allTxs = allTxs.concat(normalized);
      if (data.result.length < CONFIG.pageSize) break;
      page++;
    } else {
      break;
    }
  }
  return allTxs.length > 0 ? allTxs : null;
}

async function fetchSocialScan(address, onProgress) {
  let allTxs = [];
  let page = 1;
  const size = CONFIG.socialScanPageSize;

  while (page <= 200) { // Safety limit for smaller pages
    onProgress(`SocialScan · Page ${page}…`);
    const url = `${CONFIG.socialScanApi}/address/${address}/transactions?page=${page}&size=${size}&sort=asc`;

    const data = await fetchJSON(url);
    const list = data?.data?.transactions || data?.data?.list || data?.result || data?.transactions || [];
    if (!Array.isArray(list) || list.length === 0) break;

    const normalized = list.map(normalizeTx);
    allTxs = allTxs.concat(normalized);
    if (list.length < size) break;
    page++;
  }
  return allTxs.length > 0 ? allTxs : null;
}

async function fetchAllTxs(address, onProgress) {
  const sources = [
    { name: 'MonadScan',     fn: fetchMonadScan },
    { name: 'Etherscan V2',  fn: fetchEtherscanV2 },
    { name: 'SocialScan',    fn: fetchSocialScan },
  ];

  const errors = [];
  for (const { name, fn } of sources) {
    try {
      onProgress(`Connecting to ${name}…`);
      const txs = await fn(address, onProgress);
      if (txs) {
        console.log(`[GasTracker] ${name} returned ${txs.length} txs`);
        return { txs, source: name };
      }
    } catch (err) {
      console.warn(`[GasTracker] ${name} attempt failed:`, err.message);
      errors.push(`${name}: ${err.message}`);
    }
  }

  throw new Error(`Data retrieval failed.\n${errors.join('\n')}`);
}

// ═══════════════════════════════════════════════
//  MAIN SEARCH & RENDER
// ═══════════════════════════════════════════════
async function startSearch() {
  const input   = document.getElementById('walletInput');
  const errorEl = document.getElementById('errorMsg');
  const btn     = document.getElementById('searchBtn');
  if (!input || !errorEl || !btn) return;

  const addr = input.value.trim();
  errorEl.textContent = '';

  if (!addr) {
    errorEl.textContent = '⚠ Please enter a wallet address.';
    return;
  }
  if (!isAddress(addr)) {
    errorEl.textContent = '⚠ Invalid address. Use 0x... format.';
    return;
  }

  const originalBtnText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Searching...';
  showLoading(addr);

  try {
    setLoadingStatus('Verifying wallet state…');
    const txCountHex = await rpcCall('eth_getTransactionCount', [addr, 'latest']);
    const nonceRpc   = txCountHex !== null ? parseInt(txCountHex, 16) : null;

    setLoadingStatus('Synchronizing history…');
    const { txs, source } = await fetchAllTxs(addr, msg => setLoadingStatus(msg));

    setLoadingStatus('Aggregating data…');
    const { totalWei, sentCount } = calcTotalGas(txs, addr);
    const monValue = weiToMon(totalWei.toString());
    const displayNonce = nonceRpc !== null ? nonceRpc : sentCount;

    showResult({ addr, totalWei, monValue, sentCount, displayNonce, source });
  } catch (err) {
    closeModal();
    errorEl.textContent = `⚠ ${err.message.split('\n')[0]}`;
    console.error('[GasTracker] Error:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = originalBtnText;
  }
}

function showResult({ addr, totalWei, monValue, sentCount, displayNonce, source }) {
  const tier         = getTier(monValue);
  const monFormatted = formatMon(monValue);
  const weiDisplay   = totalWei > 0n ? totalWei.toLocaleString() : '0';
  const explorerLink = `${CONFIG.explorerUrl}/address/${addr}`;
  const safeTitle    = tier.title.replace(/'/g, "\\'").replace(/"/g, '&quot;');

  const html = `
    <div class="modal-result">
      <div class="result-label">Analyzed Wallet</div>
      <div class="wallet-display">${addr}</div>

      <div class="gas-block">
        <div class="gas-label">Total Gas Spent</div>
        <div class="gas-value">${monFormatted} <span>MON</span></div>
        <div class="gas-meta">${weiDisplay} wei</div>
        <div class="tier-badge ${tier.cls}">${tier.label}</div>
      </div>

      <div class="message-card">
        <span class="message-emoji">${tier.emoji}</span>
        <div class="message-text">${tier.title}</div>
        <div class="message-sub">${tier.msg}</div>
      </div>

      <div class="stats-row">
        <div class="stat-box">
          <div class="stat-key">Txs Sent</div>
          <div class="stat-val">${formatTxCount(sentCount)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-key">RPC Nonce</div>
          <div class="stat-val">${displayNonce !== null ? formatTxCount(displayNonce) : '—'}</div>
        </div>
      </div>

      <div class="source-note">Verified via ${source}</div>

      <div class="modal-actions">
        <button class="btn-ghost" onclick="window.open('${explorerLink}', '_blank')">Explorer ↗</button>
        <button class="btn-primary-sm" onclick="copyResult('${monFormatted}', '${safeTitle}', '${tier.emoji}')">Copy Result</button>
      </div>
    </div>
  `;
  openModal(html);
}

function copyResult(mon, title, emoji) {
  const text = `I've spent ${mon} MON on gas since Monad block 0!\n${emoji} ${title}\n\nCheck yours at Monad Gas Tracker`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.btn-primary-sm');
    if (btn) {
      btn.textContent = 'Copied! ✓';
      setTimeout(() => btn.textContent = 'Copy Result', 2000);
    }
  }).catch(console.error);
}
