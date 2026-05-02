// ═══════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════
const CONFIG = {
  rpcs: [
    'https://rpc.monad.xyz',
    'https://monad-mainnet.drpc.org',
  ],
  socialScanApi: 'https://api.socialscan.io/rest/monad-mainnet/v1/explorer',
  explorerUrl: 'https://monadscan.com',
  corsProxies: [
    u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
  ],
  maxPages: 200, // Increased for stability
  pageSize: 100,
  batchSize: 20,
  maxRetries: 3,
};

// ═══════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════
function isAddress(v) { return /^0x[0-9a-fA-F]{40}$/.test(v.trim()); }

function formatMon(monStr, maxDec = 2) {
  const parts = monStr.split('.');
  const whole = BigInt(parts[0]).toLocaleString('en-US');
  let frac = parts[1] || '0';
  frac = frac.replace(/0+$/, '');
  if (frac.length > maxDec) return `${whole}.${frac.slice(0, maxDec)}`;
  return `${whole}.${frac.padEnd(maxDec, '0')}`;
}

// ═══════════════════════════════════════════════
//  UI
// ═══════════════════════════════════════════════
function openModal(html) {
  const overlay = document.getElementById('modalOverlay');
  document.getElementById('modalContent').innerHTML = html;
  overlay.classList.add('open');
}

function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }
function handleOverlayClick(e) { if (e.target === document.getElementById('modalOverlay')) closeModal(); }

function setLoadingStatus(msg) {
  const el = document.getElementById('loadingStatus');
  if (el) el.textContent = msg;
}

function showLoading(addr) {
  openModal(`
    <div class="modal-loading">
      <div class="spinner"></div>
      <div class="loading-label">Deterministic Scan</div>
      <div class="loading-status" id="loadingStatus">Scanning network...</div>
    </div>
  `);
}

// ═══════════════════════════════════════════════
//  DATA FETCHING (ROBUST)
// ═══════════════════════════════════════════════

async function fetchWithRetry(url, ms = 15000) {
  let lastErr;
  for (let i = 0; i < CONFIG.maxRetries; i++) {
    try {
      const res = await Promise.race([
        fetch(url, { headers: { Accept: 'application/json' } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), ms))
      ]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && data.contents) return JSON.parse(data.contents); // AllOrigins
      return data;
    } catch (e) {
      lastErr = e;
      // Try next proxy on next retry
      const proxyFn = CONFIG.corsProxies[i % CONFIG.corsProxies.length];
      url = proxyFn(url.includes('?url=') ? decodeURIComponent(url.split('?url=')[1]) : url);
    }
  }
  throw lastErr;
}

async function rpcBatch(requests) {
  const body = requests.map((req, i) => ({ jsonrpc: '2.0', id: i, ...req }));
  for (const rpc of CONFIG.rpcs) {
    try {
      const res = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const results = await res.json();
      if (Array.isArray(results)) return results.sort((a, b) => a.id - b.id).map(r => r.result);
    } catch (_) {}
  }
  return [];
}

async function startSearch() {
  const input = document.getElementById('walletInput');
  const errorEl = document.getElementById('errorMsg');
  const btn = document.getElementById('searchBtn');
  if (!input || !btn) return;

  const addr = input.value.trim();
  const addrLow = addr.toLowerCase();
  errorEl.textContent = '';

  if (!isAddress(addr)) {
    errorEl.textContent = '⚠ Invalid address.';
    return;
  }

  btn.disabled = true;
  showLoading(addr);

  try {
    setLoadingStatus('Synchronizing with nodes…');
    const txCountHex = await (async () => {
      for (const rpc of CONFIG.rpcs) {
        try {
          const res = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({jsonrpc:"2.0", id:1, method:"eth_getTransactionCount", params:[addr, "latest"]}) });
          const data = await res.json();
          return data.result;
        } catch (_) {}
      }
      return '0x0';
    })();
    const nonce = parseInt(txCountHex, 16);

    setLoadingStatus('Gathering history…');
    let hashSet = new Set();
    let page = 1;
    let apiTotal = 0;

    while (page <= CONFIG.maxPages) {
      setLoadingStatus(`Indexing (Page ${page})…`);
      const data = await fetchWithRetry(`${CONFIG.socialScanApi}/address/${addr}/transactions?page=${page}&size=${CONFIG.pageSize}&sort=desc`);
      const list = data?.data || [];
      if (list.length === 0) break;

      apiTotal = data.total || apiTotal;
      list.forEach(tx => {
        if (tx.from_address?.toLowerCase() === addrLow) {
          hashSet.add(tx.hash);
        }
      });

      if (list.length < CONFIG.pageSize) break;
      page++;
    }

    const hashes = Array.from(hashSet);
    setLoadingStatus(`Calculating gas for ${hashes.length} txs…`);
    
    let totalWei = 0n;
    for (let i = 0; i < hashes.length; i += CONFIG.batchSize) {
      const batch = hashes.slice(i, i + CONFIG.batchSize);
      setLoadingStatus(`Verifying receipts (${i}/${hashes.length})…`);
      const receipts = await rpcBatch(batch.map(h => ({ method: 'eth_getTransactionReceipt', params: [h] })));
      receipts.forEach(r => {
        if (r && r.gasUsed && (r.effectiveGasPrice || r.gasPrice)) {
          totalWei += BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice || r.gasPrice);
        }
      });
    }

    const divisor = 10n ** 18n;
    const exactMonStr = (totalWei / divisor).toString() + '.' + (totalWei % divisor).toString().padStart(18, '0');
    
    showResult({ 
      addr, 
      totalWei, 
      monFormatted: formatMon(exactMonStr, 2), 
      sentCount: hashes.length, 
      displayNonce: nonce,
      integrity: hashes.length >= nonce
    });
  } catch (err) {
    closeModal();
    errorEl.textContent = '⚠ History scan inconsistent. Try again.';
  } finally {
    btn.disabled = false;
  }
}

function showResult({ addr, totalWei, monFormatted, sentCount, displayNonce, integrity }) {
  const monFloat = parseFloat(monFormatted.replace(/,/g, ''));
  const tier = getTier(monFloat);
  
  const html = `
    <div class="modal-result">
      <div class="result-label">Deterministic Analysis</div>
      <div class="wallet-display">${addr}</div>

      <div class="gas-block">
        <div class="gas-label">Total Gas Spent</div>
        <div class="gas-value">${monFormatted} <span>MON</span></div>
        <div class="gas-meta">${totalWei.toLocaleString('en-US')} wei</div>
        <div class="tier-badge ${tier.cls}">${tier.label}</div>
      </div>

      <div class="message-card">
        <span class="message-emoji">${tier.emoji}</span>
        <div class="message-text">${tier.title}</div>
        <div class="message-sub">${tier.msg}</div>
      </div>

      <div class="stats-row">
        <div class="stat-box">
          <div class="stat-key">Txs Verified</div>
          <div class="stat-val ${!integrity ? 'warn-text' : ''}">${sentCount}</div>
        </div>
        <div class="stat-box">
          <div class="stat-key">On-chain Nonce</div>
          <div class="stat-val">${displayNonce}</div>
        </div>
      </div>

      ${!integrity ? '<div class="integrity-warn">⚠ Explorer history is lagging. Some txs might be missing.</div>' : ''}

      <div class="modal-actions">
        <button class="btn-ghost" onclick="window.open('${CONFIG.explorerUrl}/address/${addr}', '_blank')">Explorer ↗</button>
        <button class="btn-primary-sm" onclick="copyResult('${monFormatted}', '${tier.title}', '${tier.emoji}')">Copy Result</button>
      </div>
    </div>
  `;
  openModal(html);
}

const TIERS = [
  { min: 10, cls: 'tier-fire', label: '🔥 ABSOLUTE DEGEN', emoji: '🔥', title: 'Legendary Status', msg: 'The network is powered by your activity.', sub: 'Top Tier' },
  { min: 5,  cls: 'tier-fire', label: '🚀 ULTRA DEGEN',    emoji: '🚀', title: 'Ultra Degen', msg: 'Incredible gas usage recorded.', sub: 'Elite' },
  { min: 1,  cls: 'tier-legend', label: '💜 OFFICIAL DEGEN', emoji: '💜', title: 'Degen confirmed', msg: 'You keep the ecosystem spinning.', sub: 'Degen' },
  { min: 0.1, cls: 'tier-gold', label: '⚡ ACTIVE', emoji: '⚡', title: 'Active Player', msg: 'Consistent network contribution.', sub: 'Active' },
  { min: 0.01, cls: 'tier-silver', label: '🌀 EXPLORING', emoji: '🌀', title: 'Explorer', msg: 'Carefully exploring the chain.', sub: 'Explorer' },
  { min: 0.001, cls: 'tier-bronze', label: '🐾 STARTING', emoji: '🐾', title: 'Early Steps', msg: 'Your journey has begun.', sub: 'Starter' },
  { min: 0, cls: 'tier-newbie', label: '🐣 NEWBIE', emoji: '🐣', title: 'Welcome', msg: 'Curiosity starts here.', sub: 'New' },
];

function getTier(mon) {
  for (const t of TIERS) if (mon >= t.min) return t;
  return TIERS[TIERS.length - 1];
}

function copyResult(mon, title, emoji) {
  const text = `I've spent exactly ${mon} MON on gas on Monad!\n${emoji} ${title}\n\nCheck yours at Monad Gas Tracker`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.btn-primary-sm');
    if (btn) {
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy Result', 2000);
    }
  });
}
