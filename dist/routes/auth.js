"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAdminIdentity = getAdminIdentity;
exports.requireApprovedAdmin = requireApprovedAdmin;
const jsonwebtoken_1 = require("jsonwebtoken");
const env_1 = require("../lib/env");
function getAdminIdentity(req) {
    const emailHeader = req.headers['x-admin-email']?.toLowerCase();
    if (emailHeader)
        return { email: emailHeader };
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
        try {
            const token = auth.replace('Bearer ', '');
            const decoded = jsonwebtoken_1.default.verify(token, env_1.env.sessionTokenSecret);
            const email = String(decoded.email ?? '').toLowerCase();
            const name = decoded.name ? String(decoded.name) : undefined;
            if (email)
                return { email, name };
        }
        catch {
        }
    }
    return { email: env_1.env.localAdminLabel, name: 'Local Admin' };
}
function requireApprovedAdmin(req, res, next) {
    const identity = getAdminIdentity(req);
    res.locals.admin = identity;
    next();
}
