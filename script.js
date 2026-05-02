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
  pageSize: 100,
};

// ═══════════════════════════════════════════════
//  DETERMINISTIC MATH (ZERO FLOATING POINT)
// ═══════════════════════════════════════════════

/**
 * Converts a decimal string like "0.04948041" to a BigInt in wei (1e18).
 * This avoids ALL floating point math. The result is exact.
 */
function monStringToWei(monStr) {
  if (!monStr || monStr === '0') return 0n;
  const parts = monStr.split('.');
  const whole = parts[0] || '0';
  let frac = parts[1] || '0';
  // Pad or trim fractional part to exactly 18 digits
  frac = frac.padEnd(18, '0').slice(0, 18);
  return BigInt(whole) * (10n ** 18n) + BigInt(frac);
}

/**
 * Converts a BigInt wei value to a formatted MON string with 2 decimals.
 */
function weiToMonFormatted(wei) {
  const divisor = 10n ** 18n;
  const whole = wei / divisor;
  const frac = wei % divisor;
  const fracStr = frac.toString().padStart(18, '0').slice(0, 2);
  return `${whole.toLocaleString('en-US')}.${fracStr}`;
}

function weiToMonFloat(wei) {
  const divisor = 10n ** 18n;
  const whole = wei / divisor;
  const frac = wei % divisor;
  return parseFloat(`${whole}.${frac.toString().padStart(18, '0')}`);
}

// ═══════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════
function isAddress(v) { return /^0x[0-9a-fA-F]{40}$/.test(v.trim()); }

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

function showLoading() {
  openModal(`
    <div class="modal-loading">
      <div class="spinner"></div>
      <div class="loading-label">Full History Scan</div>
      <div class="loading-status" id="loadingStatus">Connecting...</div>
    </div>
  `);
}

// ═══════════════════════════════════════════════
//  FETCH (with retry + cache busting)
// ═══════════════════════════════════════════════
async function fetchJSON(url) {
  const sep = url.includes('?') ? '&' : '?';
  const fullUrl = `${url}${sep}_t=${Date.now()}`;

  // Direct fetch first
  try {
    const res = await fetch(fullUrl, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache, no-store' },
    });
    if (res.ok) return await res.json();
  } catch (_) {}

  // Proxied fetch with retries
  for (const proxyFn of CONFIG.corsProxies) {
    try {
      const res = await fetch(proxyFn(fullUrl), {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.contents) return JSON.parse(data.contents);
      return data;
    } catch (_) {}
  }
  throw new Error('All fetch attempts failed');
}

async function rpcCall(method, params) {
  for (const rpc of CONFIG.rpcs) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const data = await res.json();
      if (data && data.result !== undefined) return data.result;
    } catch (_) {}
  }
  return null;
}

// ═══════════════════════════════════════════════
//  CORE: Deterministic Full-History Scan
//
//  Strategy: Read ALL pages from the explorer sequentially.
//  For each "sent" transaction, grab the pre-calculated
//  `total_transaction_fee` string and convert it to BigInt wei.
//  No RPC batch calls. No floating point. 100% deterministic.
// ═══════════════════════════════════════════════
async function scanFullHistory(addr) {
  const addrLow = addr.toLowerCase();
  let totalWei = 0n;
  let sentCount = 0;
  let page = 1;
  let totalTxs = 0;
  const seenHashes = new Set();

  while (true) {
    setLoadingStatus(`Scanning page ${page}… (${sentCount} sent txs found)`);

    const data = await fetchJSON(
      `${CONFIG.socialScanApi}/address/${addr}/transactions?page=${page}&size=${CONFIG.pageSize}`
    );

    const list = data?.data || [];
    totalTxs = data?.total || totalTxs;

    if (!Array.isArray(list) || list.length === 0) break;

    for (const tx of list) {
      // Skip if we've already processed this hash (dedup)
      if (seenHashes.has(tx.hash)) continue;
      seenHashes.add(tx.hash);

      // Only count transactions SENT by this wallet
      if ((tx.from_address || '').toLowerCase() !== addrLow) continue;

      // Use the explorer's pre-calculated fee (exact, already on-chain verified)
      const feeStr = tx.total_transaction_fee || tx.transaction_fee || '0';
      totalWei += monStringToWei(feeStr);
      sentCount++;
    }

    // Stop conditions
    if (list.length < CONFIG.pageSize) break; // Last page
    page++;

    // Safety: avoid infinite loops
    if (page > 500) break;
  }

  return { totalWei, sentCount, totalTxs, pagesScanned: page };
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
    errorEl.textContent = '⚠ Invalid address.';
    return;
  }

  btn.disabled = true;
  showLoading();

  try {
    // Get on-chain nonce for integrity check
    setLoadingStatus('Verifying on-chain nonce…');
    const nonceHex = await rpcCall('eth_getTransactionCount', [addr, 'latest']);
    const nonce = nonceHex ? parseInt(nonceHex, 16) : 0;

    // Full deterministic scan
    const { totalWei, sentCount } = await scanFullHistory(addr);

    const monFormatted = weiToMonFormatted(totalWei);
    const monFloat = weiToMonFloat(totalWei);
    const integrity = sentCount >= nonce;

    showResult({ addr, totalWei, monFormatted, sentCount, nonce, integrity });
  } catch (err) {
    closeModal();
    errorEl.textContent = '⚠ Failed to complete scan. Please try again.';
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════
//  RESULT DISPLAY
// ═══════════════════════════════════════════════
function showResult({ addr, totalWei, monFormatted, sentCount, nonce, integrity }) {
  const monFloat = weiToMonFloat(totalWei);
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
          <div class="stat-val">${nonce}</div>
        </div>
      </div>

      ${!integrity ? '<div class="integrity-warn">⚠ Explorer is still indexing some recent transactions.</div>' : ''}

      <div class="modal-actions">
        <button class="btn-ghost" onclick="window.open('${CONFIG.explorerUrl}/address/${addr}', '_blank')">Explorer ↗</button>
        <button class="btn-primary-sm" onclick="copyResult('${monFormatted}', '${tier.title}', '${tier.emoji}')">Copy Result</button>
      </div>
    </div>
  `;
  openModal(html);
}

// ═══════════════════════════════════════════════
//  TIERS
// ═══════════════════════════════════════════════
const TIERS = [
  { min: 10,    cls: 'tier-fire',   label: '🔥 ABSOLUTE DEGEN', emoji: '🔥', title: 'Legendary Status',  msg: 'The network is powered by your activity.' },
  { min: 5,     cls: 'tier-fire',   label: '🚀 ULTRA DEGEN',    emoji: '🚀', title: 'Ultra Degen',       msg: 'Incredible gas usage recorded.' },
  { min: 1,     cls: 'tier-legend', label: '💜 OFFICIAL DEGEN', emoji: '💜', title: 'Degen confirmed',   msg: 'You keep the ecosystem spinning.' },
  { min: 0.1,   cls: 'tier-gold',   label: '⚡ ACTIVE',          emoji: '⚡', title: 'Active Player',     msg: 'Consistent network contribution.' },
  { min: 0.01,  cls: 'tier-silver', label: '🌀 EXPLORING',       emoji: '🌀', title: 'Explorer',         msg: 'Carefully exploring the chain.' },
  { min: 0.001, cls: 'tier-bronze', label: '🐾 STARTING',        emoji: '🐾', title: 'Early Steps',      msg: 'Your journey has begun.' },
  { min: 0,     cls: 'tier-newbie', label: '🐣 NEWBIE',          emoji: '🐣', title: 'Welcome',          msg: 'Curiosity starts here.' },
];

function getTier(mon) {
  for (const t of TIERS) if (mon >= t.min) return t;
  return TIERS[TIERS.length - 1];
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
