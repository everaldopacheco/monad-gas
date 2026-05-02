// ═══════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════
const CONFIG = {
  // Public RPC endpoints — Monad mainnet chain 143
  rpcs: [
    'https://rpc.monad.xyz', // Official Monad RPC
    'https://monad-mainnet.drpc.org',
    'https://monad.drpc.org',
    'https://rpc.ankr.com/monad_mainnet',
  ],
  // MonadScan (Etherscan-compatible)
  // MonadScan has migrated to Etherscan V2 infrastructure
  monadScanApi: 'https://api.monadscan.com/api', 
  etherscanV2Api: 'https://api.etherscan.io/v2/api',
  monadChainId: '143',
  explorerUrl: 'https://monadscan.com',
  // SocialScan
  socialScanApi: 'https://api.socialscan.io/monad-mainnet/v1/explorer',
  // CORS proxies
  corsProxies: [
    u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    u => `https://proxy.cors.sh/${u}`,
  ],
  maxPages: 20, // Reduced to avoid long timeouts
  pageSize: 1000, // Reduced for better stability
  socialScanPageSize: 50,
};

// ═══════════════════════════════════════════════
//  TIER SYSTEM
// ═══════════════════════════════════════════════
const TIERS = [
  { min: 10,    cls: 'tier-fire',   label: '🔥 ABSOLUTE DEGEN', emoji: '🔥', title: 'Living Legend', msg: 'Over 10 MON spent on gas. You are the network.', sub: 'Top 0.1%' },
  { min: 5,     cls: 'tier-fire',   label: '🚀 ULTRA DEGEN',    emoji: '🚀', title: 'Ultra Degen',   msg: 'You went too far. Monad recorded every wei with love.', sub: 'Level: Ultra' },
  { min: 1,     cls: 'tier-legend', label: '💜 OFFICIAL DEGEN', emoji: '💜', title: 'Degen Status',  msg: 'You\'ve made things happen. Respect.', sub: 'Degen confirmed' },
  { min: 0.1,   cls: 'tier-gold',   label: '⚡ ACTIVE',          emoji: '⚡', title: 'In the Game',   msg: 'Keep going, the ecosystem needs you.', sub: 'Active player' },
  { min: 0.01,  cls: 'tier-silver', label: '🌀 EXPLORING',       emoji: '🌀', title: 'Warming Up',   msg: 'Exploring Monad carefully.', sub: 'Explorer' },
  { min: 0.001, cls: 'tier-bronze', label: '🐾 STARTING',        emoji: '🐾', title: 'First Steps',  msg: 'The beginning of your journey.', sub: 'Early adopter' },
  { min: 0,     cls: 'tier-newbie', label: '🐣 NEWBIE',          emoji: '🐣', title: 'Welcome',      msg: 'Curiosity is the first step.', sub: 'New arrival' },
];

function getTier(mon) {
  for (const t of TIERS) if (mon >= t.min) return t;
  return TIERS[TIERS.length - 1];
}

// ═══════════════════════════════════════════════
//  UTILITIES & NORMALIZATION
// ═══════════════════════════════════════════════
function isAddress(v) { return /^0x[0-9a-fA-F]{40}$/.test(v.trim()); }
function shortAddr(addr) { return addr.slice(0, 6) + '…' + addr.slice(-4); }

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
    const divisor = 10n ** 18n;
    const whole = n / divisor;
    const frac = n % divisor;
    return parseFloat(whole.toString() + '.' + frac.toString().padStart(18, '0'));
  } catch (e) { return 0; }
}

function formatMon(val) {
  if (val === 0) return '0.000000';
  if (val < 0.000001) return val.toFixed(10);
  if (val < 1) return val.toFixed(6);
  return val.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function formatTxCount(n) { return n.toLocaleString('en-US'); }

// ═══════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════
function openModal(html) {
  const overlay = document.getElementById('modalOverlay');
  document.getElementById('modalContent').innerHTML = html;
  overlay.classList.add('open');
}

function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }
function handleOverlayClick(e) { if (e.target === document.getElementById('modalOverlay')) closeModal(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function setLoadingStatus(msg) {
  const el = document.getElementById('loadingStatus');
  if (el) el.textContent = msg;
}

function showLoading(addr) {
  openModal(`
    <div class="modal-loading">
      <div class="spinner"></div>
      <div class="loading-label">Analyzing Activity...</div>
      <div class="loading-status" id="loadingStatus">Scanning network nodes...</div>
    </div>
  `);
}

// ═══════════════════════════════════════════════
//  FETCH LAYER
// ═══════════════════════════════════════════════
async function raceTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), ms))
  ]);
}

async function parseRes(res, proxyFn) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (proxyFn && proxyFn('x').includes('allorigins')) {
    try {
      const wrapper = JSON.parse(text);
      if (wrapper.contents) return JSON.parse(wrapper.contents);
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
      const res = await raceTimeout(fetch(proxyFn(url), { headers: { Accept: 'application/json' } }), ms);
      return await parseRes(res, proxyFn);
    } catch (_) {}
  }
  throw new Error('Connection failed');
}

async function rpcCall(method, params) {
  const body = { jsonrpc: '2.0', id: 1, method, params };
  for (const rpc of CONFIG.rpcs) {
    try {
      const res = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data && data.result !== undefined) return data.result;
    } catch (_) {}
  }
  return null;
}

// ═══════════════════════════════════════════════
//  API SOURCES
// ═══════════════════════════════════════════════
async function fetchMonadScan(address, onProgress) {
  let allTxs = [];
  let page = 1;
  while (page <= CONFIG.maxPages) {
    onProgress(`MonadScan · Page ${page}…`);
    // Try V2 structure first if possible, otherwise V1
    const url = `${CONFIG.monadScanApi}?chainid=${CONFIG.monadChainId}&module=account&action=txlist&address=${address}&page=${page}&offset=${CONFIG.pageSize}&sort=asc`;
    
    try {
      const data = await fetchJSON(url);
      if (!data) break;
      // Handle standard Etherscan success
      if (data.status === '1' && Array.isArray(data.result)) {
        allTxs = allTxs.concat(data.result.map(normalizeTx));
        if (data.result.length < CONFIG.pageSize) break;
        page++;
      } else if (data.status === '0' && data.message === 'No transactions found') {
        break;
      } else {
        // Log "NOTOK" or other errors but don't crash yet
        console.warn('MonadScan API Message:', data.result || data.message);
        break;
      }
    } catch (e) { break; }
  }
  return allTxs;
}

async function fetchSocialScan(address, onProgress) {
  let allTxs = [];
  let page = 1;
  while (page <= 5) { // Limited fallback
    onProgress(`SocialScan · Page ${page}…`);
    const url = `${CONFIG.socialScanApi}/address/${address}/transactions?page=${page}&size=${CONFIG.socialScanPageSize}`;
    try {
      const data = await fetchJSON(url);
      const list = data?.data?.transactions || data?.result || [];
      if (!Array.isArray(list) || list.length === 0) break;
      allTxs = allTxs.concat(list.map(normalizeTx));
      if (list.length < CONFIG.socialScanPageSize) break;
      page++;
    } catch (e) { break; }
  }
  return allTxs;
}

async function fetchAllTxs(address, onProgress) {
  let bestResult = { txs: [], source: 'None' };
  
  const sources = [
    { name: 'MonadScan', fn: fetchMonadScan },
    { name: 'SocialScan', fn: fetchSocialScan },
  ];

  for (const { name, fn } of sources) {
    try {
      onProgress(`Querying ${name}…`);
      const txs = await fn(address, onProgress);
      if (txs && txs.length > 0) {
        return { txs, source: name };
      }
    } catch (e) { console.error(`Source ${name} failed:`, e); }
  }

  return bestResult; // Return empty if nothing found
}

// ═══════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════
async function startSearch() {
  const input = document.getElementById('walletInput');
  const errorEl = document.getElementById('errorMsg');
  const btn = document.getElementById('searchBtn');
  if (!input || !btn) return;

  const addr = input.value.trim();
  errorEl.textContent = '';

  if (!isAddress(addr)) {
    errorEl.textContent = '⚠ Please enter a valid 0x address.';
    return;
  }

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = '...';
  showLoading(addr);

  try {
    setLoadingStatus('Checking RPC Nonce…');
    const txCountHex = await rpcCall('eth_getTransactionCount', [addr, 'latest']);
    const nonce = txCountHex ? parseInt(txCountHex, 16) : 0;

    setLoadingStatus('Fetching History…');
    const { txs, source } = await fetchAllTxs(addr, msg => setLoadingStatus(msg));

    setLoadingStatus('Calculating…');
    let totalWei = 0n;
    txs.forEach(tx => {
      if (tx.from === addr.toLowerCase()) {
        try { totalWei += BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice || tx.gasPrice); } catch (e) {}
      }
    });

    const monValue = weiToMon(totalWei.toString());
    showResult({ addr, totalWei, monValue, sentCount: txs.filter(t => t.from === addr.toLowerCase()).length, displayNonce: nonce, source });
  } catch (err) {
    closeModal();
    errorEl.textContent = '⚠ Network congestion. Please try again.';
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function showResult({ addr, totalWei, monValue, sentCount, displayNonce, source }) {
  const tier = getTier(monValue);
  const monFormatted = formatMon(monValue);
  const explorerLink = `${CONFIG.explorerUrl}/address/${addr}`;
  
  const html = `
    <div class="modal-result">
      <div class="result-label">Analyzed Wallet</div>
      <div class="wallet-display">${addr}</div>

      <div class="gas-block">
        <div class="gas-label">Total Gas Spent</div>
        <div class="gas-value">${monFormatted} <span>MON</span></div>
        <div class="gas-meta">${totalWei.toLocaleString()} wei</div>
        <div class="tier-badge ${tier.cls}">${tier.label}</div>
      </div>

      <div class="message-card">
        <span class="message-emoji">${tier.emoji}</span>
        <div class="message-text">${tier.title}</div>
        <div class="message-sub">${tier.msg}</div>
      </div>

      <div class="stats-row">
        <div class="stat-box"><div class="stat-key">Txs Found</div><div class="stat-val">${sentCount}</div></div>
        <div class="stat-box"><div class="stat-key">RPC Nonce</div><div class="stat-val">${displayNonce}</div></div>
      </div>

      <div class="source-note">Data from ${source === 'None' ? 'RPC (estimated)' : source}</div>

      <div class="modal-actions">
        <button class="btn-ghost" onclick="window.open('${explorerLink}', '_blank')">Explorer ↗</button>
        <button class="btn-primary-sm" onclick="copyResult('${monFormatted}', '${tier.title}', '${tier.emoji}')">Copy Result</button>
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
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy Result', 2000);
    }
  });
}
