"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLastSyncResult = getLastSyncResult;
exports.isSyncInProgress = isSyncInProgress;
exports.getLastNightlyAlert = getLastNightlyAlert;
exports.runWeightSync = runWeightSync;
exports.bulkImportFromCsv = bulkImportFromCsv;
exports.runNightlyAlert = runNightlyAlert;
exports.scheduleNightlyAlert = scheduleNightlyAlert;
exports.setVariantTrueWeight = setVariantTrueWeight;
const shopify_1 = require("../shopify");
const catalog_1 = require("./catalog");
// In-memory state
let lastSyncResult = null;
let syncInProgress = false;
let lastNightlyAlert = null;
function getLastSyncResult() { return lastSyncResult; }
function isSyncInProgress() { return syncInProgress; }
function getLastNightlyAlert() { return lastNightlyAlert; }
async function runWeightSync() {
    if (syncInProgress) throw new Error('Sync already in progress');
    syncInProgress = true;
    const records = [];
    try {
        let cursor = null;
        let hasNext = true;
        while (hasNext) {
            const afterClause = cursor ? `, after: "${cursor}"` : '';
            const query = `
        query listVariants {
          productVariants(first: 250${afterClause}) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id sku weight weightUnit
                displayName
                product { title }
                metafield(namespace: "custom", key: "actual_weight_grams") {
                  value
                }
              }
            }
          }
        }
      `;
            const resp = await (0, shopify_1.shopifyGraphql)(query, {});
            const page = resp.data?.productVariants;
            if (!page) break;
            for (const { node } of page.edges) {
                const variantId = node.id.replace('gid://shopify/ProductVariant/', '');
                const shopifyCatalogGrams = (0, catalog_1.shopifyWeightToGrams)(node.weight ?? 0, node.weightUnit ?? 'GRAMS');
                const metafieldGrams = node.metafield?.value ? parseFloat(node.metafield.value) : null;
                let status = 'ok';
                if (metafieldGrams === null || isNaN(metafieldGrams)) {
                    status = 'missing';
                } else if (shopifyCatalogGrams > 0) {
                    const ratio = metafieldGrams / shopifyCatalogGrams;
                    if (ratio < 0.8 || ratio > 1.2) status = 'mismatch';
                }
                records.push({
                    variantId,
                    sku: node.sku ?? '',
                    productTitle: node.product?.title ?? '',
                    variantTitle: node.displayName ?? '',
                    shopifyCatalogGrams,
                    metafieldGrams: (metafieldGrams !== null && !isNaN(metafieldGrams)) ? metafieldGrams : null,
                    status,
                });
            }
            hasNext = page.pageInfo.hasNextPage;
            cursor = page.pageInfo.endCursor;
        }
        const warnings = records.filter(r => r.status !== 'ok').map(r => ({
            variantId: r.variantId,
            sku: r.sku,
            productTitle: r.productTitle,
            variantTitle: r.variantTitle,
            status: r.status,
            shopifyCatalogGrams: r.shopifyCatalogGrams,
            metafieldGrams: r.metafieldGrams,
            message: r.status === 'missing'
                ? `No true weight set - will fall back to Shopify catalog (${r.shopifyCatalogGrams}g)`
                : `True weight (${r.metafieldGrams}g) differs >20% from Shopify catalog (${r.shopifyCatalogGrams}g) - please verify`,
        }));
        lastSyncResult = {
            scannedCount: records.length,
            okCount: records.filter(r => r.status === 'ok').length,
            warnings,
            records,
            lastRunAt: new Date().toISOString(),
        };
        console.log(`[weightSync] Scanned ${records.length} variants: ${lastSyncResult.okCount} ok, ${warnings.length} warnings`);
        return lastSyncResult;
    } finally {
        syncInProgress = false;
    }
}
async function bulkImportFromCsv(csvText) {
    const result = { attempted: 0, succeeded: 0, skipped: 0, errors: [] };
    const rows = csvText.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    if (rows.length === 0) return result;
    function splitCsvRow(row) {
        const result = [];
        let current = '';
        let inQuote = false;
        for (let i = 0; i < row.length; i++) {
            const ch = row[i];
            if (ch === '"') {
                inQuote = !inQuote;
            } else if (ch === ',' && !inQuote) {
                result.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current.trim());
        return result;
    }
    const headerCols = splitCsvRow(rows[0]).map(h => h.toLowerCase());
    let skuCol = -1;
    let gramsCol = -1;
    let startIdx = 0;
    const skuHeaderIdx = headerCols.findIndex(h => h === 'variant sku');
    const gramsHeaderIdx = headerCols.findIndex(h => h.includes('actual_weight_grams'));
    if (skuHeaderIdx !== -1 && gramsHeaderIdx !== -1) {
        skuCol = skuHeaderIdx;
        gramsCol = gramsHeaderIdx;
        startIdx = 1;
    } else if (headerCols[0] === 'sku' || headerCols[0] === '"sku') {
        skuCol = 0;
        gramsCol = 1;
        startIdx = 1;
    } else {
        skuCol = 0;
        gramsCol = 1;
        startIdx = 0;
    }
    const entries = [];
    for (let i = startIdx; i < rows.length; i++) {
        const parts = splitCsvRow(rows[i]);
        if (parts.length <= Math.max(skuCol, gramsCol)) continue;
        const sku = parts[skuCol];
        const grams = parseFloat(parts[gramsCol]);
        if (!sku || isNaN(grams) || grams <= 0) {
            result.errors.push({ sku: sku || '(empty)', reason: `Invalid grams value: ${parts[gramsCol]}` });
            result.skipped++;
            continue;
        }
        entries.push({ sku, grams });
    }
    result.attempted = entries.length;
    if (entries.length === 0) return result;
    const skuToVariantId = await fetchSkuToVariantIdMap(entries.map(e => e.sku));
    for (const { sku, grams } of entries) {
        const variantId = skuToVariantId.get(sku);
        if (!variantId) {
            result.errors.push({ sku, reason: 'SKU not found in Shopify' });
            result.skipped++;
            continue;
        }
        try {
            await setVariantTrueWeight(variantId, grams);
            result.succeeded++;
        } catch (err) {
            result.errors.push({ sku, reason: err?.message ?? 'Metafield write failed' });
            result.skipped++;
        }
    }
    console.log(`[weightSync] CSV import: ${result.succeeded}/${result.attempted} succeeded, ${result.skipped} skipped`);
    return result;
}
async function fetchSkuToVariantIdMap(skus) {
    const skuSet = new Set(skus);
    const map = new Map();
    let cursor = null;
    let hasNext = true;
    while (hasNext) {
        const afterClause = cursor ? `, after: "${cursor}"` : '';
        const query = `
      query listVariantIds {
        productVariants(first: 250${afterClause}) {
          pageInfo { hasNextPage endCursor }
          edges {
            node { id sku }
          }
        }
      }
    `;
        const resp = await (0, shopify_1.shopifyGraphql)(query, {});
        const page = resp.data?.productVariants;
        if (!page) break;
        for (const { node } of page.edges) {
            if (node.sku && skuSet.has(node.sku)) {
                map.set(node.sku, node.id.replace('gid://shopify/ProductVariant/', ''));
            }
        }
        hasNext = page.pageInfo.hasNextPage;
        cursor = page.pageInfo.endCursor;
        if (map.size === skuSet.size) break;
    }
    return map;
}
async function runNightlyAlert() {
    console.log('[weightSync] Running nightly alert sync...');
    try {
        const result = await runWeightSync();
        lastNightlyAlert = { ranAt: result.lastRunAt, warnings: result.warnings };
        if (result.warnings.length > 0) {
            console.warn(`[weightSync] Nightly alert: ${result.warnings.length} weight issue(s) found`);
        } else {
            console.log('[weightSync] Nightly alert: all weights OK');
        }
        return lastNightlyAlert;
    } catch (err) {
        console.error('[weightSync] Nightly alert sync failed:', err);
        throw err;
    }
}
function scheduleNightlyAlert() {
    function msUntilNextRun() {
        const now = new Date();
        const next = new Date(now);
        next.setHours(2, 0, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        return next.getTime() - now.getTime();
    }
    function scheduleNext() {
        const delay = msUntilNextRun();
        console.log(`[weightSync] Next nightly alert scheduled in ${Math.round(delay / 60000)} min`);
        setTimeout(async () => {
            try { await runNightlyAlert(); } catch (err) { console.error('[weightSync] Nightly run error:', err); }
            scheduleNext();
        }, delay);
    }
    scheduleNext();
}
async function setVariantTrueWeight(variantId, grams) {
    const gid = variantId.startsWith('gid://') ? variantId : `gid://shopify/ProductVariant/${variantId}`;
    const mutation = `
    mutation setWeight($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key value }
        userErrors { field message }
      }
    }
  `;
    const variables = {
        metafields: [{
            ownerId: gid,
            namespace: 'custom',
            key: 'actual_weight_grams',
            value: String(grams),
            type: 'number_decimal',
        }],
    };
    const resp = await (0, shopify_1.shopifyGraphql)(mutation, variables);
    const errors = resp.data?.metafieldsSet?.userErrors ?? [];
    if (errors.length > 0) {
        throw new Error(`Shopify metafield error: ${errors.map(e => e.message).join(', ')}`);
    }
    console.log(`[weightSync] Set variant ${variantId} true weight to ${grams}g`);
}
