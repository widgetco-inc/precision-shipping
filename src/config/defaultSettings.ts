import { AppSettings } from '../types';

export const defaultSettings: AppSettings = {
    carriers: {
        fedex: {
            enabled: true,
            services: [
                { code: 'FEDEX_GROUND', label: 'FedEx Ground', enabled: true, domesticOnly: true },
                { code: 'GROUND_HOME_DELIVERY', label: 'FedEx Home Delivery', enabled: true, domesticOnly: true },
                { code: 'FEDEX_2_DAY', label: 'FedEx 2Day', enabled: true, domesticOnly: true, air: true },
                { code: 'PRIORITY_OVERNIGHT', label: 'FedEx Priority Overnight', enabled: true, domesticOnly: true, air: true },
                { code: 'STANDARD_OVERNIGHT', label: 'FedEx Standard Overnight', enabled: true, domesticOnly: true, air: true },
                { code: 'INTERNATIONAL_GROUND_CA', label: 'FedEx International Ground (Canada)', enabled: true, canadaOnly: true },
                { code: 'INTERNATIONAL_PRIORITY', label: 'FedEx International Priority Express', enabled: true, internationalOnly: true, air: true },
                { code: 'INTERNATIONAL_ECONOMY', label: 'FedEx International Economy Express', enabled: true, internationalOnly: true, air: true },
                { code: 'INTERNATIONAL_CONNECT_PLUS', label: 'FedEx International Connect Plus', enabled: true, internationalOnly: true, air: true },
            ]
        },
        usps: {
            enabled: true,
            services: [
                { code: 'GROUND_ADVANTAGE', label: 'USPS Ground Advantage', enabled: true, domesticOnly: true },
                { code: 'PRIORITY_MAIL', label: 'USPS Priority Mail', enabled: true, domesticOnly: true, air: true },
                { code: 'PRIORITY_MAIL_EXPRESS', label: 'USPS Priority Mail Express', enabled: true, domesticOnly: true, air: true },
                { code: 'INTERNATIONAL_MAIL', label: 'USPS International Mail', enabled: true, internationalOnly: true },
            ]
        },
        ups: {
            enabled: true,
            services: [
                { code: 'UPS_GROUND', label: 'UPS Ground', enabled: true, domesticOnly: true },
                { code: 'UPS_2ND_DAY_AIR', label: 'UPS 2-day', enabled: true, domesticOnly: true, air: true },
            ]
        },
        ups_f: {
            enabled: true,
            services: [
                { code: 'UPS_GROUND_SAVER_LIGHT', label: 'UPS Ground Saver (<1 lb)', enabled: true, domesticOnly: true, excludeHiAk: true, maxWeightLb: 1 },
                { code: 'UPS_GROUND_SAVER_HEAVY', label: 'UPS Ground Saver (1 lb+)', enabled: true, domesticOnly: true, excludeHiAk: true, minWeightLb: 1 },
            ]
        },
        ups_one_rate: {
            enabled: true,
            services: [
                { code: 'UPS_ONE_RATE_GROUND', label: 'UPS One Rate Ground', enabled: true, domesticOnly: true },
                { code: 'UPS_ONE_RATE_2ND_DAY_AIR', label: 'UPS One Rate 2-Day Air', enabled: true, domesticOnly: true, air: true },
                { code: 'UPS_ONE_RATE_NEXT_DAY_AIR_SAVER', label: 'UPS One Rate Next Day Air Saver', enabled: true, domesticOnly: true, air: true },
                { code: 'UPS_ONE_RATE_NEXT_DAY_AIR', label: 'UPS One Rate Next Day Air', enabled: true, domesticOnly: true, air: true },
            ]
        },
        dhl_ecomm: {
            enabled: true,
            services: [
                { code: 'DHLeCommerceParcelExpedited', label: 'DHL eCommerce Parcel Expedited', enabled: true, domesticOnly: true, air: true },
                { code: 'DHLeCommerceParcelExpeditedMax', label: 'DHL eCommerce Parcel Expedited Max', enabled: true, domesticOnly: true, air: true },
                { code: 'DHLeCommerceParcelGround', label: 'DHL eCommerce Parcel Ground', enabled: true, domesticOnly: true },
                { code: 'DHLeCommerceParcelPlus', label: 'DHL eCommerce Parcel Plus Expedited', enabled: true, domesticOnly: true, air: true },
                { code: 'DHLeCommerceBPMExpedited', label: 'DHL eCommerce BPM Expedited', enabled: true, domesticOnly: true, air: true },
                { code: 'DHLeCommerceBPMGround', label: 'DHL eCommerce BPM Ground', enabled: true, domesticOnly: true },
            ]
        },
        dhl_express: {
            enabled: true,
            services: [
                { code: 'DHLExpressExpressWorldwide', label: 'DHL Express Worldwide', enabled: true, internationalOnly: true, air: true },
                { code: 'DHLExpressExpressMidpointDelivery', label: 'DHL Express Midpoint Delivery', enabled: true, internationalOnly: true, air: true },
                { code: 'DHLExpressExpressEasyNDX', label: 'DHL Express Easy', enabled: true, internationalOnly: true, air: true },
                { code: 'DHLExpressWorldwideNDX', label: 'DHL Express Worldwide NDX', enabled: true, internationalOnly: true, air: true },
            ]
        },
        fedex_wallet: {
            enabled: true,
            services: [
                { code: 'FEDEX_GROUND', label: 'FedEx Ground (Wallet)', enabled: true, domesticOnly: true },
                { code: 'GROUND_HOME_DELIVERY', label: 'FedEx Home Delivery (Wallet)', enabled: true, domesticOnly: true },
                { code: 'FEDEX_2_DAY', label: 'FedEx 2Day (Wallet)', enabled: true, domesticOnly: true, air: true },
                { code: 'PRIORITY_OVERNIGHT', label: 'FedEx Priority Overnight (Wallet)', enabled: true, domesticOnly: true, air: true },
                { code: 'INTERNATIONAL_PRIORITY', label: 'FedEx International Priority Express (Wallet)', enabled: true, internationalOnly: true, air: true },
                { code: 'INTERNATIONAL_ECONOMY', label: 'FedEx International Economy Express (Wallet)', enabled: true, internationalOnly: true, air: true },
            ]
        },
        asendia: {
            enabled: true,
            services: [
                { code: 'AsendiaUSePAQ', label: 'Asendia ePAQ', enabled: true, internationalOnly: true },
                { code: 'AsendiaUSePAQPlus', label: 'Asendia ePAQ Plus', enabled: true, internationalOnly: true },
                { code: 'AsendiaUSePAQTracked', label: 'Asendia ePAQ Tracked', enabled: true, internationalOnly: true },
                { code: 'AsendiaUSePAQStandard', label: 'Asendia ePAQ Standard', enabled: true, internationalOnly: true },
            ]
        },
    },
    packaging: {
        packageWeightPct: 1.05,
        expressEnvelopeMaxWeightLb: 2,
        useFedexEnvelopeForExpress: true,
    maxWeightPerBoxLb: 45,
    skuBoxOverrides: [
      // 6-U underlayment: heavy boxes, cap at 25 lb per box
      { skuPrefix: '6-U', maxWeightPerBoxLb: 25 },
      // 6-W and 6-ROLL: each unit ships in its own individual box
      { skuPrefix: '6-W', shipsIndividually: true },
      { skuPrefix: '6-ROLL', shipsIndividually: true },
    ],
    },
    access: {
        allowedAdminEmails: [],
    },
      closureDates: [
              // ── 2026 US Federal / FedEx+UPS observed holidays ──────────────────────────
          { date: '2026-01-01', label: "New Year's Day 2026" },
          { date: '2026-01-19', label: 'Martin Luther King Jr. Day 2026' },
          { date: '2026-02-16', label: "Presidents' Day 2026" },
          { date: '2026-05-25', label: 'Memorial Day 2026' },
          { date: '2026-07-03', label: 'Independence Day (observed) 2026' },
          { date: '2026-09-07', label: 'Labor Day 2026' },
          { date: '2026-11-26', label: 'Thanksgiving 2026' },
          { date: '2026-12-25', label: 'Christmas Day 2026' },
              // ── 2027 ────────────────────────────────────────────────────────────────────
          { date: '2027-01-01', label: "New Year's Day 2027" },
          { date: '2027-01-18', label: 'Martin Luther King Jr. Day 2027' },
          { date: '2027-02-15', label: "Presidents' Day 2027" },
          { date: '2027-05-31', label: 'Memorial Day 2027' },
          { date: '2027-07-05', label: 'Independence Day (observed) 2027' },
          { date: '2027-09-06', label: 'Labor Day 2027' },
          { date: '2027-11-25', label: 'Thanksgiving 2027' },
          { date: '2027-12-24', label: 'Christmas Eve (observed) 2027' },
          { date: '2027-12-27', label: 'Christmas Day (observed) 2027' },
            ],
};    
