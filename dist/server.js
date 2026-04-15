"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const env_1 = require("./lib/env");
const app_1 = __importDefault(require("./routes/app"));
const preview_1 = __importDefault(require("./routes/preview"));
const carrier_1 = __importDefault(require("./routes/carrier"));
const admin_1 = __importDefault(require("./routes/admin"));
const app = (0, express_1.default)();
app.use((_req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); }); // noindex
app.set('view engine', 'ejs');
app.set('views', [path_1.default.join(__dirname, '..', 'src', 'views'), path_1.default.join(__dirname, 'views')]);
app.use((0, helmet_1.default)({ contentSecurityPolicy: false }));
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '2mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use(express_1.default.static(path_1.default.join(__dirname, '..', 'src', 'public')));
app.use(express_1.default.static(path_1.default.join(__dirname, 'public')));
app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'widgetco-shipping-app' });
app.get('/version', (_req, res) => {
    res.json({ v: '2026-04-09-B', src: true });
});
app.get('/shipping-preview.js', (_req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.sendFile(path_1.default.join(__dirname, '..', 'src', 'public', 'shipping-preview.js'));
});

});
app.use(app_1.default);
app.use(preview_1.default);
app.use(carrier_1.default);
app.use(admin_1.default);
app.get('/', (_req, res) => res.redirect('/app'));
app.listen(env_1.env.port, () => {
    console.log(`WidgetCo shipping app listening on port ${env_1.env.port}`);
});
