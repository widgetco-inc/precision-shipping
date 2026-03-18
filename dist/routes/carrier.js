"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ratingEngine_1 = require("../services/ratingEngine");
const fedex_1 = require("../carriers/fedex");
const ups_1 = require("../carriers/ups");
const usps_1 = require("../carriers/usps");
const router = (0, express_1.Router)();
router.post('/carrier-service/rates', async (req, res) => {
    const rateReq = req.body?.rate;
    const items = Array.isArray(rateReq?.items) ? rateReq.items : [];
    const lines = items.map((item) => ({
        variantId: String(item.variant_id ?? ''),
        sku: item.sku ? String(item.sku) : undefined,
        title: item.product_title ? String(item.product_title) : undefined,
        quantity: Number(item.quantity ?? 1),
        trueWeightGrams: undefined
    }));
    const destination = {
        countryCode: String(rateReq?.destination?.country ?? 'US'),
        provinceCode: rateReq?.destination?.province ? String(rateReq.destination.province) : undefined,
        postalCode: rateReq?.destination?.postal_code ? String(rateReq.destination.postal_code) : undefined,
        city: rateReq?.destination?.city ? String(rateReq.destination.city) : undefined
    };
    const shipment = (0, ratingEngine_1.buildShipment)(lines, destination);
    const adapters = [new fedex_1.FedexAdapter(), new ups_1.UpsAdapter(), new usps_1.UspsAdapter()];
    const results = await Promise.all(adapters.map((adapter) => adapter.getRates(shipment)));
    const quotes = results.flat().sort((a, b) => a.amountUsd - b.amountUsd);
    res.json({
        rates: quotes.map((quote) => ({
            service_name: quote.serviceName,
            service_code: `${quote.carrier}:${quote.serviceCode}`,
            total_price: Math.round(quote.amountUsd * 100).toString(),
            currency: quote.currency,
            description: `Calculated at true shipment weight ${shipment.totalShipmentWeightLb.toFixed(2)} lb`
        }))
    });
});
exports.default = router;
