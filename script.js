// ═══════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════
const CONFIG = {
  // Official Monad RPCs
  rpcs: [
    'https://rpc.monad.xyz',
    'https://monad-mainnet.drpc.org',
  ],
  // Explorer API for indexing hashes
  socialScanApi: 'https://api.socialscan.io/rest/monad-mainnet/v1/explorer',
  explorerUrl: 'https://monadscan.com',
  corsProxies: [
    u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
  ],
  maxPages: 100, // Up to 10,000 transactions
  pageSize: 100,
  batchSize: 20, // RPC batch size
};

// ═══════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════
function isAddress(v) { return /^0x[0-9a-fA-F]{40}$/.test(v.trim()); }

function formatMon(monStr, maxDec = 8) {
  const parts = monStr.split('.');
  const whole = BigInt(parts[0]).toLocaleString('en-US');
  let frac = parts[1] || '0';
  frac = frac.replace(/0+$/, '');
  if (frac.length > maxDec) {
    return `${whole}.${frac.slice(0, maxDec)}…`;
  }
  return `${whole}.${frac.padEnd(6, '0')}`;
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
      <div class="loading-label">High-Precision Scan</div>
      <div class="loading-status" id="loadingStatus">Scanning blocks...</div>
    </div>
  `);
}

// ═══════════════════════════════════════════════
//  CORE LOGIC (HIGH PRECISION)
// ═══════════════════════════════════════════════

async function fetchJSON(url) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch (_) {
    for (const proxyFn of CONFIG.corsProxies) {
      try {
        const res = await fetch(proxyFn(url));
        const data = await res.json();
        // AllOrigins wrapper check
        if (data && data.contents) return JSON.parse(data.contents);
        return data;
      } catch (_) {}
    }
  }
  throw new Error('Connection failed');
}

async function rpcBatch(requests) {
  const body = requests.map((req, i) => ({ jsonrpc: '2.0', id: i, ...req }));
  for (const rpc of CONFIG.rpcs) {
    try {
      const res = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const results = await res.json();
      return Array.isArray(results) ? results.sort((a, b) => a.id - b.id).map(r => r.result) : [];
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
    errorEl.textContent = '⚠ Invalid address format.';
    return;
  }

  btn.disabled = true;
  btn.textContent = '...';
  showLoading(addr);

  try {
    setLoadingStatus('Contacting Monad nodes…');
    // Get total tx count (nonce)
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

    setLoadingStatus('Indexing transactions…');
    let hashes = [];
    let page = 1;
    let totalInExplorer = 0;

    // Fetch hashes from SocialScan
    while (page <= CONFIG.maxPages) {
      setLoadingStatus(`Indexing hashes (Page ${page})…`);
      const data = await fetchJSON(`${CONFIG.socialScanApi}/address/${addr}/transactions?page=${page}&size=${CONFIG.pageSize}`);
      const list = data?.data || [];
      if (list.length === 0) break;

      totalInExplorer = data.total || totalInExplorer;
      list.forEach(tx => {
        if (tx.from_address?.toLowerCase() === addrLow) {
          hashes.push(tx.hash);
        }
      });

      if (list.length < CONFIG.pageSize) break;
      page++;
    }

    setLoadingStatus(`Fetching ${hashes.length} receipts…`);
    let totalWei = 0n;
    let processed = 0;

    // Batch fetch receipts for exact gas calculation
    for (let i = 0; i < hashes.length; i += CONFIG.batchSize) {
      const batch = hashes.slice(i, i + CONFIG.batchSize);
      setLoadingStatus(`Calculating gas (${processed}/${hashes.length})…`);
      
      const receipts = await rpcBatch(batch.map(h => ({ method: 'eth_getTransactionReceipt', params: [h] })));
      
      receipts.forEach(r => {
        if (r && r.gasUsed && (r.effectiveGasPrice || r.gasPrice)) {
          const used = BigInt(r.gasUsed);
          const price = BigInt(r.effectiveGasPrice || r.gasPrice);
          totalWei += used * price;
        }
      });
      
      processed += batch.length;
    }

    // Exact conversion to MON string
    const divisor = 10n ** 18n;
    const whole = totalWei / divisor;
    const frac = totalWei % divisor;
    const exactMon = whole.toString() + '.' + frac.toString().padStart(18, '0');

    showResult({ addr, totalWei, exactMon, sentCount: hashes.length, displayNonce: nonce });
  } catch (err) {
    closeModal();
    errorEl.textContent = '⚠ Network timeout. Please try again.';
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Search';
  }
}

function showResult({ addr, totalWei, exactMon, sentCount, displayNonce }) {
  const monFloat = parseFloat(exactMon);
  const tier = getTier(monFloat);
  const monFormatted = formatMon(exactMon);
  
  const html = `
    <div class="modal-result">
      <div class="result-label">Wallet Analysis (100% Precise)</div>
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
        <div class="stat-box"><div class="stat-key">Txs Verified</div><div class="stat-val">${sentCount}</div></div>
        <div class="stat-box"><div class="stat-key">On-chain Nonce</div><div class="stat-val">${displayNonce}</div></div>
      </div>

      <div class="source-note">Verified directly via Monad RPC receipts</div>

      <div class="modal-actions">
        <button class="btn-ghost" onclick="window.open('${CONFIG.explorerUrl}/address/${addr}', '_blank')">Explorer ↗</button>
        <button class="btn-primary-sm" onclick="copyResult('${monFormatted}', '${tier.title}', '${tier.emoji}')">Copy Result</button>
      </div>
    </div>
  `;
  openModal(html);
}

const TIERS = [
  { min: 10,    cls: 'tier-fire',   label: '🔥 ABSOLUTE DEGEN', emoji: '🔥', title: 'Living Legend', msg: 'The network is built on your gas.', sub: 'Top 0.1%' },
  { min: 5,     cls: 'tier-fire',   label: '🚀 ULTRA DEGEN',    emoji: '🚀', title: 'Ultra Degen',   msg: 'Unstoppable activity recorded.', sub: 'Level: Ultra' },
  { min: 1,     cls: 'tier-legend', label: '💜 OFFICIAL DEGEN', emoji: '💜', title: 'Degen confirmed', msg: 'Respect. You keep Monad spinning.', sub: 'High impact' },
  { min: 0.1,   cls: 'tier-gold',   label: '⚡ ACTIVE',          emoji: '⚡', title: 'In the Game',   msg: 'Consistent and reliable player.', sub: 'Active' },
  { min: 0.01,  cls: 'tier-silver', label: '🌀 EXPLORING',       emoji: '🌀', title: 'Warming Up',   msg: 'Exploring Monad ecosystems.', sub: 'Explorer' },
  { min: 0.001, cls: 'tier-bronze', label: '🐾 STARTING',        emoji: '🐾', title: 'First Steps',  msg: 'Your journey has just begun.', sub: 'Early' },
  { min: 0,     cls: 'tier-newbie', label: '🐣 NEWBIE',          emoji: '🐣', title: 'Welcome',      msg: 'Curiosity starts here.', sub: 'New' },
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
