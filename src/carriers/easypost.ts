import { CarrierAdapter } from './base';
import { RateQuote, Shipment } from '../types';
import { getSettings } from '../services/settingsStore';
import { env } from '../lib/env';

// EasyPost carrier account IDs mapped to our carrier setting keys
const CARRIER_ACCOUNTS: Record<string, string> = {
		fedex: 'ca_544bae948c20483c947448953a736823',
		usps: 'ca_2046b502461e4ad68b6cf6c0f0f9843b',
};

// Maps our internal service codes to the EasyPost service code returned in rate responses.
const EP_SERVICE_CODE: Record<string, Record<string, string>> = {
		fedex: {
					FEDEX_GROUND: 'FEDEX_GROUND',
					GROUND_HOME_DELIVERY: 'GROUND_HOME_DELIVERY',
					FEDEX_2_DAY: 'FEDEX_2_DAY',
					PRIORITY_OVERNIGHT: 'PRIORITY_OVERNIGHT',
					STANDARD_OVERNIGHT: 'STANDARD_OVERNIGHT',
					INTERNATIONAL_GROUND_CA: 'FEDEX_GROUND',
					INTERNATIONAL_PRIORITY: 'FEDEX_INTERNATIONAL_PRIORITY',
					INTERNATIONAL_ECONOMY: 'FEDEX_INTERNATIONAL_ECONOMY',
					INTERNATIONAL_CONNECT_PLUS: 'FEDEX_INTERNATIONAL_CONNECT_PLUS',
		},
		usps: {
					GROUND_ADVANTAGE: 'GroundAdvantage',
					PRIORITY_MAIL: 'Priority',
					PRIORITY_MAIL_EXPRESS: 'Express',
					INTERNATIONAL_MAIL: 'FirstClassPackageInternationalService',
		},
		ups: {
					UPS_GROUND: 'Ground',
					UPS_2ND_DAY_AIR: '2ndDayAir',
		},
		ups_f: {
					UPS_GROUND_SAVER_LIGHT: 'UPSGroundSaver',
					UPS_GROUND_SAVER_HEAVY: 'UPSGroundSaver',
		},
		ups_one_rate: {
					UPS_ONE_RATE_GROUND: 'Ground',
					UPS_ONE_RATE_2ND_DAY_AIR: '2ndDayAir',
					UPS_ONE_RATE_NEXT_DAY_AIR_SAVER: 'NextDayAirSaver',
					UPS_ONE_RATE_NEXT_DAY_AIR: 'NextDayAir',
		},
		dhl_ecomm: {
					DHLeCommerceParcelExpedited: 'DHLeCommerceParcelExpedited',
					DHLeCommerceParcelExpeditedMax: 'DHLeCommerceParcelExpeditedMax',
					DHLeCommerceParcelGround: 'DHLeCommerceParcelGround',
					DHLeCommerceParcelPlus: 'DHLeCommerceParcelPlusExpedited',
					DHLeCommerceBPMExpedited: 'DHLeCommerceBPMExpedited',
					DHLeCommerceBPMGround: 'DHLeCommerceBPMGround',
		},
		dhl_express: {
					DHLExpressExpressWorldwide: 'DHLExpressExpressWorldwide',
					DHLExpressExpressMidpointDelivery: 'DHLExpressExpressMidpointDelivery',
					DHLExpressExpressEasyNDX: 'DHLExpressExpressEasyNDX',
					DHLExpressWorldwideNDX: 'DHLExpressWorldwideNDX',
		},
		fedex_wallet: {
					FEDEX_GROUND: 'FEDEX_GROUND',
					GROUND_HOME_DELIVERY: 'GROUND_HOME_DELIVERY',
					FEDEX_2_DAY: 'FEDEX_2_DAY',
					PRIORITY_OVERNIGHT: 'PRIORITY_OVERNIGHT',
					INTERNATIONAL_PRIORITY: 'FEDEX_INTERNATIONAL_PRIORITY',
					INTERNATIONAL_ECONOMY: 'FEDEX_INTERNATIONAL_ECONOMY',
		},
		asendia: {
					AsendiaUSePAQ: 'AsendiaUSePAQ',
					AsendiaUSePAQPlus: 'AsendiaUSePAQPlus',
					AsendiaUSePAQTracked: 'AsendiaUSePAQTracked',
					AsendiaUSePAQStandard: 'AsendiaUSePAQStandard',
		},
};

function internalCarrierKey(carrierKey: string): RateQuote['carrier'] {
		if (carrierKey === 'fedex' || carrierKey === 'fedex_wallet') return 'fedex';
		if (carrierKey === 'ups' || carrierKey === 'ups_f' || carrierKey === 'ups_one_rate') return 'ups';
		if (carrierKey === 'dhl_ecomm' || carrierKey === 'dhl_express') return 'dhl_ecomm' as RateQuote['carrier'];
		if (carrierKey === 'asendia') return 'asendia' as RateQuote['carrier'];
		return carrierKey as RateQuote['carrier'];
}

const ZIP_ORIGINS: Record<string, { street1: string; city: string; state: string }> = {
		'77204': { street1: '4800 Calhoun Rd', city: 'Houston', state: 'TX' },
		'77001': { street1: '1 Main St', city: 'Houston', state: 'TX' },
		'90210': { street1: '9595 Wilshire Blvd', city: 'Beverly Hills', state: 'CA' },
		'10001': { street1: '1 Penn Plaza', city: 'New York', state: 'NY' },
		'92806': { street1: '1550 S State College Blvd', city: 'Anaheim', state: 'CA' },
};

// ---------------------------------------------------------------------------
// getNextShipDate — returns the next valid ship date as "YYYY-MM-DD".
// Rules: Mon–Fri are ship days with a 4:00 PM CST cutoff.
// If today is a weekday and before 4 PM CST → ship today.
// If today is a weekday and at/after 4 PM CST → ship next business day.
// If today is Saturday or Sunday → ship Monday.
// ---------------------------------------------------------------------------
function getNextShipDate(): string {
		// Get current time in CST/CDT (America/Chicago)
	const nowCst = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
		const dayOfWeek = nowCst.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
	const hourFrac = nowCst.getHours() + nowCst.getMinutes() / 60;
		const CUTOFF = 16; // 4:00 PM

	const d = new Date(nowCst);

	if (dayOfWeek === 0) {
				// Sunday → Monday
			d.setDate(d.getDate() + 1);
	} else if (dayOfWeek === 6) {
				// Saturday → Monday
			d.setDate(d.getDate() + 2);
	} else if (hourFrac >= CUTOFF) {
				// Weekday at/after cutoff → next business day
			if (dayOfWeek === 5) {
							// Friday after cutoff → Monday
					d.setDate(d.getDate() + 3);
			} else {
							d.setDate(d.getDate() + 1);
			}
	}
		// else: weekday before cutoff → ship today (d unchanged)

	const yyyy = d.getFullYear();
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${yyyy}-${mm}-${dd}`;
}

function usZipToState(zip: string): string {
		const prefix = parseInt(zip.substring(0, 3), 10);
		if (prefix >= 0 && prefix <= 9) return 'PR';
		if (prefix >= 100 && prefix <= 149) return 'MA';
		if (prefix >= 150 && prefix <= 196) return 'PA';
		if (prefix >= 197 && prefix <= 199) return 'DE';
		if (prefix >= 200 && prefix <= 205) return 'DC';
		if (prefix >= 206 && prefix <= 212) return 'MD';
		if (prefix >= 214 && prefix <= 219) return 'MD';
		if (prefix >= 220 && prefix <= 246) return 'VA';
		if (prefix >= 247 && prefix <= 268) return 'WV';
		if (prefix >= 269 && prefix <= 298) return 'NC';
		if (prefix >= 299 && prefix <= 299) return 'SC';
		if (prefix >= 300 && prefix <= 319) return 'GA';
		if (prefix >= 320 && prefix <= 339) return 'FL';
		if (prefix >= 340 && prefix <= 349) return 'FL';
		if (prefix >= 350 && prefix <= 369) return 'AL';
		if (prefix >= 370 && prefix <= 385) return 'TN';
		if (prefix >= 386 && prefix <= 397) return 'MS';
		if (prefix >= 400 && prefix <= 427) return 'KY';
		if (prefix >= 430 && prefix <= 459) return 'OH';
		if (prefix >= 460 && prefix <= 479) return 'IN';
		if (prefix >= 480 && prefix <= 499) return 'MI';
		if (prefix >= 500 && prefix <= 528) return 'IA';
		if (prefix >= 530 && prefix <= 549) return 'WI';
		if (prefix >= 550 && prefix <= 567) return 'MN';
		if (prefix >= 570 && prefix <= 577) return 'SD';
		if (prefix >= 580 && prefix <= 588) return 'ND';
		if (prefix >= 590 && prefix <= 599) return 'MT';
		if (prefix >= 600 && prefix <= 629) return 'IL';
		if (prefix >= 630 && prefix <= 658) return 'MO';
		if (prefix >= 660 && prefix <= 679) return 'KS';
		if (prefix >= 680 && prefix <= 693) return 'NE';
		if (prefix >= 700 && prefix <= 714) return 'LA';
		if (prefix >= 716 && prefix <= 729) return 'AR';
		if (prefix >= 730 && prefix <= 749) return 'OK';
		if (prefix >= 750 && prefix <= 799) return 'TX';
		if (prefix >= 800 && prefix <= 816) return 'CO';
		if (prefix >= 820 && prefix <= 831) return 'WY';
		if (prefix >= 832 && prefix <= 838) return 'ID';
		if (prefix >= 840 && prefix <= 847) return 'UT';
		if (prefix >= 850 && prefix <= 865) return 'AZ';
		if (prefix >= 870 && prefix <= 884) return 'NM';
		if (prefix >= 885 && prefix <= 885) return 'TX';
		if (prefix >= 889 && prefix <= 898) return 'NV';
		if (prefix >= 900 && prefix <= 961) return 'CA';
		if (prefix >= 967 && prefix <= 968) return 'HI';
		if (prefix >= 969 && prefix <= 969) return 'GU';
		if (prefix >= 970 && prefix <= 979) return 'OR';
		if (prefix >= 980 && prefix <= 994) return 'WA';
		if (prefix >= 995 && prefix <= 999) return 'AK';
		if (prefix >= 10 && prefix <= 69) return 'NY';
		if (prefix >= 70 && prefix <= 89) return 'NJ';
		if (prefix >= 90 && prefix <= 99) return 'CT';
		return 'US';
}

// ---------------------------------------------------------------------------
// Rate cache — keyed by (accountId, fromZip, toZip, country, weightOz, boxes, residential)
// TTL: 90 seconds. Prevents redundant EasyPost calls when Shopify hits the
// carrier callback multiple times during a single checkout session.
// ---------------------------------------------------------------------------
interface CacheEntry {
		data: Map<string, { rate: number; estDeliveryDays: number | null }>;
		expiresAt: number;
}
const rateCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 90_000;

function cacheKey(
		accountId: string,
		fromZip: string,
		shipment: Shipment,
		isResidential: boolean,
	): string {
		return [
					accountId,
					fromZip,
					shipment.destination.postalCode,
					shipment.destination.countryCode,
					(shipment.heaviestBoxWeightLb * 16).toFixed(2),
					shipment.numberOfBoxes,
					isResidential ? '1' : '0',
				].join('|');
}

function getCached(key: string): Map<string, { rate: number; estDeliveryDays: number | null }> | null {
		const entry = rateCache.get(key);
		if (!entry) return null;
		if (Date.now() > entry.expiresAt) {
					rateCache.delete(key);
					return null;
		}
		return entry.data;
}

function setCache(key: string, data: Map<string, { rate: number; estDeliveryDays: number | null }>): void {
		rateCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// sleep helper
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// fetchAllRatesForAccount — with retry on 429 and transient carrier errors.
// Retries up to MAX_RETRIES times with exponential backoff starting at
// RETRY_BASE_MS. Only retries on 429 or EasyPost "carrier failed to respond".
// ---------------------------------------------------------------------------
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;

async function fetchAllRatesForAccount(
		accountId: string,
		shipment: Shipment,
		fromZip?: string,
		isResidential?: boolean,
	): Promise<Map<string, { rate: number; estDeliveryDays: number | null }>> {
		const resolvedFromZip = fromZip ?? '92806';
		const residential = isResidential ?? false;

	// Cache lookup
	const key = cacheKey(accountId, resolvedFromZip, shipment, residential);
		const cached = getCached(key);
		if (cached) {
					console.log('[EasyPost] cache hit for', accountId);
					return cached;
		}

	const shipDate = getNextShipDate();
		console.log('[EasyPost] using ship_date:', shipDate);

	const body = {
				shipment: {
								from_address: {
													...(ZIP_ORIGINS[resolvedFromZip] ?? { street1: '1 Main St', city: '', state: '' }),
													zip: resolvedFromZip,
													country: 'US',
													company: 'WidgetCo',
								},
								to_address: {
													street1: shipment.destination.address1 ?? '123 Main St',
													city: shipment.destination.city ?? '',
													state: shipment.destination.provinceCode ?? (shipment.isDomestic ? usZipToState(shipment.destination.postalCode) : ''),
													zip: shipment.destination.postalCode,
													country: shipment.destination.countryCode,
													company: 'WidgetCo',
													...(residential ? { residential: true } : {}),
								},
								parcel: {
													weight: shipment.heaviestBoxWeightLb * 16,
													length: 12,
													width: 9,
													height: 4,
								},
								...(!shipment.isDomestic ? {
													customs_info: {
																			contents_type: 'merchandise',
																			restriction_type: 'none',
																			eel_pfc: 'NOEEI 30.37(a)',
																			customs_items: [{
																										description: 'Merchandise',
																										quantity: 1,
																										value: 1,
																										weight: shipment.heaviestBoxWeightLb * 16,
																										origin_country: 'US',
																			}],
													},
								} : {}),
								options: {
													parcel_count: shipment.numberOfBoxes,
													ship_date: shipDate,
								},
								carrier_accounts: [accountId],
				},
	};

	const authHeader = 'Basic ' + Buffer.from(env.easypostApiKey + ':').toString('base64');

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
				if (attempt > 0) {
								const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1); // 500ms, 1000ms
					console.warn(`[EasyPost] retry ${attempt}/${MAX_RETRIES} for ${accountId} after ${delay}ms`);
								await sleep(delay);
				}

			const resp = await fetch('https://api.easypost.com/v2/shipments', {
							method: 'POST',
							headers: {
												Authorization: authHeader,
												'Content-Type': 'application/json',
							},
							body: JSON.stringify(body),
			});

			if (!resp.ok) {
							if (resp.status === 429) {
												if (attempt < MAX_RETRIES) continue; // will retry
								console.warn('[EasyPost] rate-limited (429) for', accountId, '— all retries exhausted, skipping carrier');
												return new Map();
							}
							const errText = await resp.text();
							console.error('[EasyPost] non-ok', accountId, resp.status, errText.substring(0, 500));
							throw new Error('[EasyPost] ' + accountId + ' ' + resp.status + ': ' + errText.substring(0, 200));
			}

			const data = await resp.json();
				const rates: any[] = data.rates ?? [];

			if (rates.length === 0) {
							// Check if this is a transient "carrier failed to respond" error — retry if so
					const messages: any[] = data.messages ?? [];
							const isTransient = messages.some((m: any) =>
												typeof m.message === 'string' && m.message.toLowerCase().includes('failed to respond')
															  			);
							if (isTransient && attempt < MAX_RETRIES) {
												console.warn('[EasyPost] transient carrier error for', accountId, '— retrying');
												continue;
							}
							console.warn('[EasyPost] ZERO rates for', accountId,
										 				'messages:', JSON.stringify(messages),
										 				'errors:', JSON.stringify(data.errors ?? []),
										 				'from_zip:', resolvedFromZip);
							const emptyMap = new Map<string, { rate: number; estDeliveryDays: number | null }>();
							setCache(key, emptyMap);
							return emptyMap;
			}

			console.log('[EasyPost] raw services for', accountId, JSON.stringify(rates.map((r: any) => r.service)));
				const rateMap = new Map<string, { rate: number; estDeliveryDays: number | null }>();
				for (const r of rates) {
								rateMap.set(r.service as string, { rate: parseFloat(r.rate), estDeliveryDays: r.est_delivery_days ?? null });
				}
				console.log('[EasyPost] rateMap for', accountId, JSON.stringify(Array.from(rateMap.keys())));

			setCache(key, rateMap);
				return rateMap;
	}

	// Should not reach here, but satisfy TypeScript
	return new Map();
}

export class EasyPostAdapter implements CarrierAdapter {
		async getRates(shipment: Shipment, fromZip?: string, isResidential?: boolean): Promise<RateQuote[]> {
					const settings = getSettings();
					if (!env.easypostApiKey) {
									console.warn('[easypost] EASYPOST_API_KEY is not set — skipping live rates');
									return [];
					}
					const quotes: RateQuote[] = [];

			// Determine which carrier keys are enabled
			// Pre-filter: skip accounts that are disabled OR have no services
			// eligible for this destination — avoids unnecessary EasyPost API calls.
			const enabledCarrierKeys = Object.entries(settings.carriers)
						.filter(([key, cfg]) => {
											if (!cfg.enabled || !(key in CARRIER_ACCOUNTS)) return false;
											return cfg.services.some((svc) => {
																	if (!svc.enabled) return false;
																	if (svc.domesticOnly && !shipment.isDomestic) return false;
																	if (svc.internationalOnly && !shipment.isInternational) return false;
																	if (svc.canadaOnly && !shipment.isCanada) return false;
																	if (svc.hiAkOnly && !shipment.isHiAkTerritory) return false;
																	if (svc.excludeHiAk && shipment.isHiAkTerritory) return false;
																	if (svc.maxWeightLb != null && shipment.totalShipmentWeightLbs > svc.maxWeightLb) return false;
																	if (svc.minWeightLb != null && shipment.totalShipmentWeightLbs < svc.minWeightLb) return false;
																	return true;
											});
						})
						.map(([key]) => key);

			// Fetch all rates in parallel — ONE API call per carrier account
			const ratesByCarrierKey = new Map<string, Map<string, { rate: number; estDeliveryDays: number | null }>>();
					const carrierResults = await Promise.allSettled(
									enabledCarrierKeys.map(async (carrierKey) => {
														const accountId = CARRIER_ACCOUNTS[carrierKey];
														const rateMap = await fetchAllRatesForAccount(accountId, shipment, fromZip, isResidential);
														ratesByCarrierKey.set(carrierKey, rateMap);
									}),
								);
					carrierResults.forEach((r, i) => {
									if (r.status === 'rejected') {
														console.error('[EasyPost] carrier failed', enabledCarrierKeys[i], r.reason);
									}
					});

			// Match our service definitions to the fetched rates
			for (const [carrierKey, carrierSettings] of Object.entries(settings.carriers)) {
							if (!carrierSettings.enabled) continue;
							if (!(carrierKey in CARRIER_ACCOUNTS)) continue;
							const rateMap = ratesByCarrierKey.get(carrierKey) ?? new Map<string, { rate: number; estDeliveryDays: number | null }>();
							const svcCodeMap = EP_SERVICE_CODE[carrierKey] ?? {};

						for (const svc of carrierSettings.services) {
											if (!svc.enabled) continue;

								if (svc.domesticOnly && !shipment.isDomestic) continue;
											if (svc.internationalOnly && !shipment.isInternational) continue;
											if (svc.canadaOnly && !shipment.isCanada) continue;
											if (svc.hiAkOnly && !shipment.isHiAkTerritory) continue;
											if (svc.excludeHiAk && shipment.isHiAkTerritory) continue;
											if (svc.maxWeightLb != null && shipment.totalShipmentWeightLbs > svc.maxWeightLb) continue;
											if (svc.minWeightLb != null && shipment.totalShipmentWeightLbs < svc.minWeightLb) continue;

								const epServiceCode = svcCodeMap[svc.code];
											if (!epServiceCode) continue;

								const epRate = rateMap.get(epServiceCode);
											if (epRate == null) continue;
											const rawRate = epRate.rate;
											const estDeliveryDays = epRate.estDeliveryDays;

								let finalAmount = rawRate * shipment.numberOfBoxes;
											if (svc.handlingFeeUsd) finalAmount += svc.handlingFeeUsd;
											if (svc.flatRateUsd != null) finalAmount = svc.flatRateUsd;
											if (svc.freeThresholdUsd != null && shipment.totalShipmentWeightLbs === 0) finalAmount = 0;

								quotes.push({
														carrier: internalCarrierKey(carrierKey),
														serviceCode: svc.code,
														serviceName: svc.label,
														amountUsd: finalAmount,
														currency: 'USD',
														estDeliveryDays,
														debug: `rateSource=easypost carrier=${carrierKey} acct=${CARRIER_ACCOUNTS[carrierKey]} epSvc=${epServiceCode}`,
								});
						}
			}

			return quotes;
		}
}
