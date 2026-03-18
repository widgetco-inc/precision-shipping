"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const shopify_1 = require("../shopify");
const auth_1 = require("./auth");
const router = (0, express_1.Router)();
router.post('/admin/register-carrier-service', auth_1.requireApprovedAdmin, async (_req, res) => {
    try {
        const result = await (0, shopify_1.registerCarrierService)();
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
});
exports.default = router;
