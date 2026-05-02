// ═══════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════
const CONFIG = {
  rpcs: [
    'https://rpc.monad.xyz',
    'https://monad-mainnet.drpc.org',
    'https://rpc.ankr.com/monad_mainnet',
  ],
  // Primary working explorer for Monad Mainnet
  socialScanApi: 'https://api.socialscan.io/rest/monad-mainnet/v1/explorer',
  monadScanApi: 'https://api.monadscan.com/api', 
  monadChainId: '143',
  explorerUrl: 'https://monadscan.com',
  corsProxies: [
    u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    u => `https://proxy.cors.sh/${u}`,
  ],
  maxPages: 25,
  pageSize: 100, // SocialScan REST API size
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
//  UTILITIES
// ═══════════════════════════════════════════════
function isAddress(v) { return /^0x[0-9a-fA-F]{40}$/.test(v.trim()); }

function formatMon(val) {
  if (val === 0) return '0.000000';
  if (val < 0.000001) return val.toFixed(10);
  if (val < 1) return val.toFixed(6);
  return val.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

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
      <div class="loading-label">Analyzing Monad History...</div>
      <div class="loading-status" id="loadingStatus">Initializing scan...</div>
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
  throw new Error('All connection attempts failed.');
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
async function fetchSocialScan(address, onProgress) {
  let allTxs = [];
  let page = 1;
  const size = CONFIG.pageSize;
  const addrLow = address.toLowerCase();

  while (page <= CONFIG.maxPages) {
    onProgress(`SocialScan · Page ${page}…`);
    const url = `${CONFIG.socialScanApi}/address/${address}/transactions?page=${page}&size=${size}`;
    
    try {
      const data = await fetchJSON(url);
      const list = data?.data || [];
      if (!Array.isArray(list) || list.length === 0) break;
      
      list.forEach(tx => {
        if ((tx.from_address || '').toLowerCase() === addrLow) {
          allTxs.push(parseFloat(tx.total_transaction_fee || tx.transaction_fee || 0));
        }
      });

      if (list.length < size) break;
      page++;
    } catch (e) { break; }
  }
  return allTxs;
}

// MonadScan fallback (Etherscan-compatible)
async function fetchMonadScan(address, onProgress) {
  let totalGas = 0;
  const url = `${CONFIG.monadScanApi}?module=account&action=txlist&address=${address}&startblock=0&endblock=latest&page=1&offset=1000&sort=asc`;
  try {
    const data = await fetchJSON(url);
    if (data && data.status === '1' && Array.isArray(data.result)) {
      const addrLow = address.toLowerCase();
      data.result.forEach(tx => {
        if (tx.from.toLowerCase() === addrLow) {
          const feeWei = BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice || tx.gasPrice || 0);
          totalGas += parseFloat(feeWei.toString()) / 1e18;
        }
      });
      return [totalGas]; // Return as array for compatibility
    }
  } catch (e) {}
  return [];
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
    errorEl.textContent = '⚠ Invalid 0x address.';
    return;
  }

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = '...';
  showLoading(addr);

  try {
    setLoadingStatus('Checking RPC status…');
    const txCountHex = await rpcCall('eth_getTransactionCount', [addr, 'latest']);
    const nonce = txCountHex ? parseInt(txCountHex, 16) : 0;

    setLoadingStatus('Scanning history…');
    const fees = await fetchSocialScan(addr, msg => setLoadingStatus(msg));
    
    let totalMon = fees.reduce((a, b) => a + b, 0);
    let source = 'SocialScan';

    if (totalMon === 0 && nonce > 0) {
      setLoadingStatus('Trying fallback source…');
      const fallbackFees = await fetchMonadScan(addr, msg => setLoadingStatus(msg));
      totalMon = fallbackFees.reduce((a, b) => a + b, 0);
      source = totalMon > 0 ? 'MonadScan' : 'RPC (estimated)';
    }

    showResult({ addr, totalMon, sentCount: fees.length || (totalMon > 0 ? 'Multiple' : 0), displayNonce: nonce, source });
  } catch (err) {
    closeModal();
    errorEl.textContent = '⚠ Connection error. Try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function showResult({ addr, totalMon, sentCount, displayNonce, source }) {
  const tier = getTier(totalMon);
  const monFormatted = formatMon(totalMon);
  const explorerLink = `${CONFIG.explorerUrl}/address/${addr}`;
  
  const html = `
    <div class="modal-result">
      <div class="result-label">Analyzed Wallet</div>
      <div class="wallet-display">${addr}</div>

      <div class="gas-block">
        <div class="gas-label">Total Gas Spent</div>
        <div class="gas-value">${monFormatted} <span>MON</span></div>
        <div class="gas-meta">~${(totalMon * 1e18).toLocaleString()} wei</div>
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

      <div class="source-note">Verified via ${source}</div>

      <div class="modal-actions">
        <button class="btn-ghost" onclick="window.open('${explorerLink}', '_blank')">Explorer ↗</button>
        <button class="btn-primary-sm" onclick="copyResult('${monFormatted}', '${tier.title}', '${tier.emoji}')">Copy Result</button>
      </div>
    </div>
  `;
  openModal(html);
}

function copyResult(mon, title, emoji) {
  const text = `I've spent ${mon} MON on gas on Monad!\n${emoji} ${title}\n\nCheck yours at Monad Gas Tracker`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.btn-primary-sm');
    if (btn) {
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy Result', 2000);
    }
  });
}
