"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const env_1 = require("../lib/env");
const router = express_1.default.Router();
const users = [
    { email: 'jg@widgetco.com', hash: env_1.env.jonathanPasswordHash },
    { email: 'lgerkey@widgetco.com', hash: env_1.env.lauraPasswordHash },
];
// GET /login
router.get('/login', (req, res) => {
    if (req.session && req.session.userEmail) {
        return res.redirect('/app');
    }
    res.render('login', { error: null, prefill: '' });
});
// POST /login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email);
    if (!user || !user.hash) {
        return res.render('login', { error: 'Invalid email or password.', prefill: email || '' });
    }
    const match = await bcryptjs_1.default.compare(password, user.hash);
    if (!match) {
        return res.render('login', { error: 'Invalid email or password.', prefill: email || '' });
    }
    req.session.userEmail = user.email;
    res.redirect('/app');
});
// GET /logout
router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});
exports.default = router;
