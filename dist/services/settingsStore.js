"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettings = getSettings;
exports.saveSettings = saveSettings;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const defaultSettings_1 = require("../config/defaultSettings");
const dataDir = path_1.default.join(process.cwd(), 'data');
const filePath = path_1.default.join(dataDir, 'settings.json');
function ensureStore() {
    if (!fs_1.default.existsSync(dataDir))
        fs_1.default.mkdirSync(dataDir, { recursive: true });
    if (!fs_1.default.existsSync(filePath))
        fs_1.default.writeFileSync(filePath, JSON.stringify(defaultSettings_1.defaultSettings, null, 2));
}
function getSettings() {
    ensureStore();
    return JSON.parse(fs_1.default.readFileSync(filePath, 'utf8'));
}
function saveSettings(settings) {
    ensureStore();
    fs_1.default.writeFileSync(filePath, JSON.stringify(settings, null, 2));
    return settings;
}
