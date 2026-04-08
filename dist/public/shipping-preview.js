// ââ Precision Shipping â Preview Page âââââââââââââââââââââââââââââââââââââââââââââââââââ
// v2 — force redeploy
// 1. Original single-line preview form (existing behaviour)
// 2. SKU Cart Estimator â add multiple SKUs + quantities,
//    auto-resolves true weights, calls the preview API, shows
//    a formatted breakdown of shipment weights + carrier rates.

/* âââ 1. ORIGINAL FORM âââ */
document.getElementById('pForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const f   = new FormData(e.target);
  const out = document.getElementById('pOut');
  out.textContent = 'Loadingâ¦';
  try {
    const r = await fetch('/shipping/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination: { countryCode: String(f.get('cc') || 'US'), postalCode: String(f.get('zip') || '') },
        lines: [{ quantity: Number(f.get('qty') || 1), trueWeightGrams: Number(f.get('wg') || 0) }]
      })
    });
    out.textContent = JSON.stringify(await r.json(), null, 4);
  } catch (err) {
    out.textContent = 'Error: ' + err.message;
  }
});

/* âââ 2. SKU CART ESTIMATOR âââ */
(async function initSkuEstimator() {
  /* Load SKU weights */
  const skuWeights = {}, skuList = [];
  try {
    const html = await fetch('/shipping/sku-weights').then(r => r.text());
    const doc  = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('tbody tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 3) return;
      const sku = cells[0].textContent.trim();
      const wg  = parseFloat(cells[2].querySelector('input')?.value);
      if (sku && !isNaN(wg)) { skuWeights[sku.toUpperCase()] = wg; skuList.push(sku); }
    });
  } catch (_) {}

  /* Styles */
  const style = document.createElement('style');
  style.textContent = `
    .sku-estimator{margin-top:24px;border-top:1px solid rgba(255,255,255,.10);padding-top:20px}
    .sku-estimator-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
    .sku-estimator-title{font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af}
    .sku-cart-table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:14px}
    .sku-cart-table th{text-align:left;font-size:12px;font-weight:500;color:#9ca3af;padding:0 8px 8px;border-bottom:1px solid rgba(255,255,255,.08)}
    .sku-cart-table td{padding:8px;vertical-align:middle;border-bottom:1px solid rgba(255,255,255,.05)}
    .sku-cart-table tr:last-child td{border-bottom:none}
    .sku-input-wrap{position:relative;width:100%}
    .sku-input,.sku-qty-input{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#f1f5f9;font-family:inherit;font-size:13px;padding:7px 10px;outline:none;transition:border-color .15s;box-sizing:border-box;width:100%}
    .sku-qty-input{width:70px;text-align:center}
    .sku-input:focus,.sku-qty-input:focus{border-color:rgba(255,255,255,.4)}
    .sku-input.sku-found{border-color:#4ade80}.sku-input.sku-not-found{border-color:#f87171}
    .sku-weight-badge{font-size:12px;color:#9ca3af;white-space:nowrap}.sku-weight-badge.found{color:#4ade80}
    .sku-remove-btn{background:none;border:none;cursor:pointer;color:#6b7280;font-size:16px;padding:2px 6px;border-radius:4px;transition:color .15s,background .15s}
    .sku-remove-btn:hover{color:#f87171;background:rgba(248,113,113,.1)}
    .sku-add-btn{background:rgba(255,255,255,.06);border:1px dashed rgba(255,255,255,.2);border-radius:6px;color:#9ca3af;font-size:13px;cursor:pointer;padding:8px 16px;width:100%;transition:background .15s,color .15s;font-family:inherit;margin-bottom:14px}
    .sku-add-btn:hover{background:rgba(255,255,255,.10);color:#f1f5f9}
    .sku-totals{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px 14px;display:flex;gap:24px;margin-bottom:14px;font-size:13px;flex-wrap:wrap}
    .sku-total-item{color:#9ca3af}.sku-total-item strong{color:#f1f5f9;margin-left:6px}
    .sku-run-btn{background:#1e293b;border:1px solid rgba(255,255,255,.18);color:#f1f5f9;font-family:inherit;font-size:14px;font-weight:600;padding:10px 22px;border-radius:8px;cursor:pointer;transition:background .15s}
    .sku-run-btn:hover{background:#334155}.sku-run-btn:disabled{opacity:.5;cursor:default}
    .sku-clear-btn{background:none;border:none;font-size:12px;color:#6b7280;cursor:pointer;padding:2px 8px;border-radius:4px;font-family:inherit;transition:color .15s}
    .sku-clear-btn:hover{color:#f87171}
    .sku-autocomplete{position:absolute;top:100%;left:0;right:0;background:#1e293b;border:1px solid rgba(255,255,255,.2);border-radius:6px;z-index:1000;max-height:180px;overflow-y:auto;margin-top:2px;box-shadow:0 8px 24px rgba(0,0,0,.4);display:none}
    .sku-autocomplete-item{padding:8px 12px;font-size:13px;cursor:pointer;color:#e2e8f0;display:flex;justify-content:space-between}
    .sku-autocomplete-item:hover{background:rgba(255,255,255,.1)}
    .sku-autocomplete-weight{font-size:11px;color:#4ade80;margin-left:8px}
  `;
  document.head.appendChild(style);

  /* HTML */
  document.querySelector('.sh-card').insertAdjacentHTML('beforeend', `
    <div class="sku-estimator" id="skuEstimator">
      <div class="sku-estimator-header">
        <span class="sku-estimator-title">SKU Cart Estimator</span>
        <button class="sku-clear-btn" id="skuClearAll">Clear all</button>
      </div>
      <table class="sku-cart-table">
        <thead><tr><th style="width:45%">SKU</th><th style="width:15%">Qty</th><th style="width:25%">Unit weight</th><th style="width:15%"></th></tr></thead>
        <tbody id="skuCartBody"></tbody>
      </table>
      <button class="sku-add-btn" id="skuAddRow">+ Add SKU</button>
      <div class="sku-totals">
        <span class="sku-total-item">Items: <strong id="skuTotalQty">0</strong></span>
        <span class="sku-total-item">Total weight (g): <strong id="skuTotalWeightG">0</strong></span>
        <span class="sku-total-item">Total weight (lb): <strong id="skuTotalWeightLb">0</strong></span>
        <span class="sku-total-item">Lines: <strong id="skuTotalLines">0</strong></span>
      </div>
      <button class="sku-run-btn" id="skuRunPreview">Run preview with SKU cart</button>
    </div>
  `);

  /* Logic */
  let rowCount = 0;
  const getRows = () => Array.from(document.querySelectorAll('#skuCartBody tr[data-row]'));

  function updateTotals() {
    let qty = 0, wg = 0, lines = 0;
    getRows().forEach(r => {
      const s = r.querySelector('.sku-input').value.toUpperCase().trim();
      const q = parseInt(r.querySelector('.sku-qty-input').value) || 0;
      const w = skuWeights[s];
      if (w !== undefined && q > 0) { qty += q; wg += q * w; lines++; }
    });
    document.getElementById('skuTotalQty').textContent      = qty.toLocaleString();
    document.getElementById('skuTotalWeightG').textContent  = wg.toFixed(3);
    document.getElementById('skuTotalWeightLb').textContent = (wg * 0.00220462).toFixed(4);
    document.getElementById('skuTotalLines').textContent    = lines;
  }

  function showAC(input, dd) {
    const val = input.value.toUpperCase().trim();
    dd.innerHTML = '';
    if (!val) { dd.style.display = 'none'; return; }
    const matches = skuList.filter(s => s.toUpperCase().includes(val)).slice(0, 20);
    if (!matches.length) { dd.style.display = 'none'; return; }
    matches.forEach(sku => {
      const item = document.createElement('div');
      item.className = 'sku-autocomplete-item';
      const w = skuWeights[sku.toUpperCase()];
      item.innerHTML = `<span>${sku}</span><span class="sku-autocomplete-weight">${w !== undefined ? w + 'g' : ''}</span>`;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = sku; dd.style.display = 'none';
        const row = input.closest('tr'), badge = row.querySelector('.sku-weight-badge');
        if (w !== undefined) { input.className = 'sku-input sku-found'; badge.textContent = w + ' g/unit'; badge.className = 'sku-weight-badge found'; }
        updateTotals(); row.querySelector('.sku-qty-input').focus();
      });
      dd.appendChild(item);
    });
    dd.style.display = 'block';
  }

  function addRow(skuVal = '', qtyVal = 1) {
    const id = ++rowCount;
    const sku = skuVal.toUpperCase().trim(), w = skuWeights[sku], found = w !== undefined;
    const tr = document.createElement('tr');
    tr.setAttribute('data-row', id);
    tr.innerHTML = `
      <td><div class="sku-input-wrap">
        <input type="text" class="sku-input${found ? ' sku-found' : ''}" placeholder="e.g. 1-250-BLK-L" value="${skuVal}" autocomplete="off"/>
        <div class="sku-autocomplete"></div>
      </div></td>
      <td><input type="number" class="sku-qty-input" value="${qtyVal}" min="1" step="1"/></td>
      <td><span class="sku-weight-badge${found ? ' found' : ''}">${found ? w + ' g/unit' : skuVal ? 'Not found' : 'â'}</span></td>
      <td><button class="sku-remove-btn" title="Remove">â</button></td>`;
    document.getElementById('skuCartBody').appendChild(tr);
    const inp = tr.querySelector('.sku-input'), dd = tr.querySelector('.sku-autocomplete');
    const badge = tr.querySelector('.sku-weight-badge');
    inp.addEventListener('input', () => {
      showAC(inp, dd);
      const s = inp.value.toUpperCase().trim(), wt = skuWeights[s];
      if (!s)            { inp.className = 'sku-input'; badge.textContent = 'â'; badge.className = 'sku-weight-badge'; }
      else if (wt !== undefined) { inp.className = 'sku-input sku-found'; badge.textContent = wt + ' g/unit'; badge.className = 'sku-weight-badge found'; }
      else               { inp.className = 'sku-input sku-not-found'; badge.textContent = 'Not found'; badge.className = 'sku-weight-badge'; }
      updateTotals();
    });
    inp.addEventListener('focus', () => showAC(inp, dd));
    inp.addEventListener('blur',  () => setTimeout(() => { dd.style.display = 'none'; }, 150));
    inp.addEventListener('keydown', e => { if (e.key === 'Tab' || e.key === 'Enter') dd.style.display = 'none'; });
    tr.querySelector('.sku-qty-input').addEventListener('input', updateTotals);
    tr.querySelector('.sku-remove-btn').addEventListener('click', () => { tr.remove(); updateTotals(); });
    updateTotals();
    if (!skuVal) inp.focus();
  }

  addRow();

  document.getElementById('skuAddRow').addEventListener('click', () => addRow());
  document.getElementById('skuClearAll').addEventListener('click', () => { document.getElementById('skuCartBody').innerHTML = ''; addRow(); });

  document.getElementById('skuRunPreview').addEventListener('click', async () => {
    const btn = document.getElementById('skuRunPreview'), pOut = document.getElementById('pOut');
    const lines = [];
    getRows().forEach(r => {
      const s = r.querySelector('.sku-input').value.toUpperCase().trim();
      const q = parseInt(r.querySelector('.sku-qty-input').value) || 0;
      const w = skuWeights[s];
      if (w !== undefined && q > 0) lines.push({ quantity: q, trueWeightGrams: w });
    });
    if (!lines.length) { pOut.textContent = 'No valid SKUs in cart.'; return; }
    const cc  = document.querySelector('[name="cc"]')?.value  || 'US';
    const zip = document.querySelector('[name="zip"]')?.value || '';
    btn.disabled = true; btn.textContent = 'Runningâ¦'; pOut.textContent = 'Calculatingâ¦';
    try {
      const data = await fetch('/shipping/api/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: { countryCode: cc, postalCode: zip }, lines })
      }).then(r => r.json());
      let out = '';
      if (data.shipment) {
        const s = data.shipment;
        out += `ââ Shipment Summary âââââââââââââââââââââââââââââââââââââââââââââââââ\n`;
        out += `  Total lines:     ${lines.length}\n`;
        out += `  Total qty:       ${lines.reduce((a, l) => a + l.quantity, 0).toLocaleString()}\n`;
        out += `  Net weight:      ${s.totalNetWeightLb?.toFixed(4)} lb\n`;
        out += `  Shipment weight: ${s.totalShipmentWeightLb?.toFixed(4)} lb (incl. tare: ${s.tareLb} lb)\n\n`;
        out += `ââ Line Details âââââââââââââââââââââââââââââââââââââââââââââââââââ\n`;
        (s.lines || []).forEach((line, i) => {
          const label = getRows()[i]?.querySelector('.sku-input').value || `Line ${i + 1}`;
          out += `  ${label}: qty=${line.quantity}, ${line.trueWeightGrams}g/unit â ${line.resolvedWeightLb?.toFixed(4)} lb\n`;
        });
      }
      if (data.rates?.length) {
        out += `\nââ Carrier Rates âââââââââââââââââââââââââââââââââââââââââââââââââ\n`;
        data.rates.forEach(r => { out += `  ${r.carrier.toUpperCase().padEnd(8)} ${r.serviceName.padEnd(30)} $${r.amountUsd?.toFixed(2)} ${r.currency}\n`; });
      }
      pOut.textContent = out;
    } catch (err) { pOut.textContent = 'Error: ' + err.message; }
    finally { btn.disabled = false; btn.textContent = 'Run preview with SKU cart'; }
  });
})();
