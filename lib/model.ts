export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface SnapshotInput {
  as_of: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow extends SnapshotProtocol {
  rank: number;
  token_status: 'pre-token';
  watchlist: boolean;
  selection_group: 'watchlist' | 'early-below-floor' | 'supplemental';
  age_days: number;
  growth_pct: number;
  category_bucket: string;
  category_median_pct: number;
  global_median_pct: number;
  category_factor: number;
  growth_factor: number;
  downside_factor: number;
  age_factor: number;
  categoryFactor: number;
  growthFactor: number;
  downsideFactor: number;
  ageFactor: number;
  implied_value_usd: number;
  capital_usd: number;
  hold_days: number;
  cadence: string;
  farm_steps: string[];
}

export interface LiveRow extends SnapshotProtocol {
  rank: number;
  token_status: 'token-bearing';
  age_days: number;
  growth_pct: number;
  category_bucket: string;
  category_factor: number;
  growth_factor: number;
  downside_factor: number;
  age_factor: number;
  implied_value_usd: number;
}

export interface BoardStats {
  watchlist_size: number;
  watchlist_covered: number;
  board_size: number;
  early_size: number;
  supplemental_size: number;
  supplemental_above_floor: number;
  supplemental_below_floor: number;
  live_size: number;
  cex_count: number;
  versioned_count: number;
  product_filtered_count: number;
  early_below_floor_available: number;
}

export const MODEL_VERSION = 'v2-nonlinear-family-risk-age';

// categoryFactor 使用 lending、dex、derivatives、restaking、bridge、vault、yield 七个
// family bucket，无法归入这些 family 的原始 category 使用 general。这样每个中位数都在
// family 级别聚合，避免 raw category 只有一两行时产生不稳定的基准。
export const MODEL_CONSTANTS = {
  tvl_weight: 0.25,
  growth_weight: 0.2,
  growth_scale: 20,
  downside_weight: 0.2,
  downside_cap: 60,
  age_floor: 0.55,
  age_horizon_days: 1095,
  age_default_days: 365,
  category_delta: 0.2,
  category_min: 0.9,
  category_max: 1.1,
  growth_min: -60,
  growth_max: 120,
  capital_rounding: 25,
  model_version: MODEL_VERSION,
  family_buckets: ['lending', 'dex', 'derivatives', 'restaking', 'bridge', 'vault', 'yield', 'general'],
} as const;

const PRODUCT_CATEGORIES = new Set(['cex', 'bridge', 'canonical bridge', 'liquid staking', 'liquid restaking', 'restaked btc']);
const VERSIONED_NAME = /\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(?:wrapped|staked|staking)\b/i;
const DAY_MS = 86_400_000;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

export const familyForCategory = (category: string): string => {
  const value = category.toLowerCase();
  if (value.includes('lending') || value.includes('cdp') || value.includes('collateral')) return 'lending';
  if (value.includes('dex') || value.includes('swap') || value.includes('exchange')) return 'dex';
  if (value.includes('derivative') || value.includes('option') || value.includes('synthetic') || value.includes('basis') || value.includes('leveraged') || value.includes('prediction')) return 'derivatives';
  if (value.includes('restak') || value.includes('staking') || value.includes('staked')) return 'restaking';
  if (value.includes('bridge')) return 'bridge';
  if (value.includes('vault') || value.includes('curator') || value.includes('allocator')) return 'vault';
  if (value.includes('yield') || value.includes('farm') || value.includes('liquidity manager')) return 'yield';
  return 'general';
};

const isPreToken = (record: SnapshotProtocol): boolean => record.gecko_id == null && record.symbol == null;
const isVersioned = (record: SnapshotProtocol): boolean => VERSIONED_NAME.test(record.name);
const isRankable = (record: SnapshotProtocol): boolean => isPreToken(record) && record.category !== 'CEX' && !isVersioned(record);
const isProductFiltered = (record: SnapshotProtocol): boolean => PRODUCT_CATEGORIES.has(record.category.toLowerCase()) || PRODUCT_WORD.test(record.name);

const ageDaysFor = (record: SnapshotProtocol, asOf: string): number => {
  const listedMs = record.listed_at === null ? Number.NaN : Date.parse(`${record.listed_at}T00:00:00Z`);
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(listedMs) || !Number.isFinite(asOfMs)) return MODEL_CONSTANTS.age_default_days;
  return Math.max(0, Math.floor((asOfMs - listedMs) / DAY_MS));
};

const growthFor = (record: SnapshotProtocol): number => clamp(typeof record.change_7d === 'number' ? record.change_7d : 0, MODEL_CONSTANTS.growth_min, MODEL_CONSTANTS.growth_max);

const factorInputs = (record: SnapshotProtocol, asOf: string, familyMedians: Map<string, number>, globalMedian: number) => {
  const age_days = ageDaysFor(record, asOf);
  const growth_pct = growthFor(record);
  const category_bucket = familyForCategory(record.category);
  const category_median_pct = familyMedians.get(category_bucket) ?? globalMedian;
  const category_factor = clamp(1 + MODEL_CONSTANTS.category_delta * (category_median_pct - globalMedian) / 100, MODEL_CONSTANTS.category_min, MODEL_CONSTANTS.category_max);
  const growth_factor = 1 + MODEL_CONSTANTS.growth_weight * Math.tanh(growth_pct / MODEL_CONSTANTS.growth_scale);
  const downside_factor = 1 - MODEL_CONSTANTS.downside_weight * Math.max(0, -growth_pct) / MODEL_CONSTANTS.downside_cap;
  const agePart = 1 - Math.exp(-Math.min(age_days, MODEL_CONSTANTS.age_horizon_days) / 365);
  const ageFactorPart = 1 - Math.exp(-MODEL_CONSTANTS.age_horizon_days / 365);
  const age_factor = MODEL_CONSTANTS.age_floor + (1 - MODEL_CONSTANTS.age_floor) * agePart / ageFactorPart;
  return { age_days, growth_pct, category_bucket, category_median_pct, global_median_pct: globalMedian, category_factor, growth_factor, downside_factor, age_factor };
};

const impliedValue = (tvl_usd: number, factors: Pick<BoardRow, 'category_factor' | 'growth_factor' | 'downside_factor' | 'age_factor'>): number => Math.max(1, Math.round(tvl_usd * MODEL_CONSTANTS.tvl_weight * factors.category_factor * factors.growth_factor * factors.downside_factor * factors.age_factor));

const roundTo25 = (value: number): number => Math.round(value / MODEL_CONSTANTS.capital_rounding) * MODEL_CONSTANTS.capital_rounding;

const farmActionFor = (family: string): string => {
  if (family === 'lending') return 'supply a small stablecoin position and test one reversible borrow';
  if (family === 'dex') return 'complete one small swap, then add a reversible liquidity position';
  if (family === 'derivatives') return 'open a small collateralized position and record the risk screen';
  if (family === 'restaking') return 'stake or restake a small amount and record the withdrawal queue';
  if (family === 'bridge') return 'make a small reversible cross-chain transfer and confirm arrival';
  if (family === 'vault') return 'deposit a small amount into the primary vault and save its terms';
  if (family === 'yield') return 'make a small deposit or farm action and record the reward route';
  return 'use the primary protocol entry point for one small reversible action';
};

const farmStepsFor = (record: SnapshotProtocol, factors: ReturnType<typeof factorInputs>): { steps: string[]; capital_usd: number; hold_days: number; cadence: string } => {
  const baseCapital = record.tvl_usd >= 5_000_000_000 ? 250 : record.tvl_usd >= 1_000_000_000 ? 150 : record.tvl_usd >= 100_000_000 ? 100 : 50;
  const capital = roundTo25(Math.min(baseCapital, factors.growth_pct < -15 ? 50 : factors.age_days < 90 ? 75 : baseCapital));
  const hold_days = factors.age_days < 90 ? 60 : factors.age_days < 365 ? 45 : 30;
  const cadence = factors.age_days < 45 ? 'every 48 hours' : 'every 7 days';
  const gas = 'the first network gas fee';
  const action = farmActionFor(factors.category_bucket);
  const steps = [
    `1. Confirm ${record.name}, its ${record.category} category, chain entry, official route, slug ${record.slug}, and the fresh wallet address. Cost: ${gas}. Time: 5-10 minutes.`,
    `2. ${action}. Use a test amount of $${capital} capital and keep the action reversible. Cost: $${capital} capital plus network gas. Time: 15-45 minutes.`,
    `3. Complete a second verifiable action in the same protocol, save the transaction hash, and record the resulting balance or position. Cost: network gas. Time: 10-20 minutes.`,
    `4. Recheck the TVL page, wallet balance, reward asset, and transaction record on a ${cadence} cadence. Cost: one review gas fee when a transaction is needed. Time: 10 minutes.`,
    `5. Hold the position for at least ${hold_days} days while tracking the seven-day change. ${factors.growth_pct < -15 ? 'Pause adding capital and review exit conditions while growth is below -15%.' : 'Add no capital until the next scheduled review is complete.'} Cost: $${capital} capital held. Time: ${hold_days} days.`,
    `6. Check the protocol points or rewards page for eligibility, snapshot timing, claim route, and lock period. Save the page date and any qualification evidence. Cost: $0 unless the page shows a fee. Time: 10 minutes.`,
    `7. Check withdrawal, slippage, exit fee, and bridge arrival before exiting. Withdraw, then archive the wallet, date, amount, transaction hash, and result. Cost: exit gas and any displayed fee. Time: 15-30 minutes.`,
  ];
  for (const step of steps) if (step.length < 20 || step.length > 600 || !step.includes('Cost:') || !step.includes('Time:')) throw new Error(`Invalid farm step for ${record.slug}`);
  return { steps, capital_usd: capital, hold_days, cadence };
};

const rowFromRecord = (record: SnapshotProtocol, asOf: string, familyMedians: Map<string, number>, globalMedian: number, selection_group: BoardRow['selection_group'], watchlist: boolean): BoardRow => {
  const factors = factorInputs(record, asOf, familyMedians, globalMedian);
  const implied_value_usd = impliedValue(record.tvl_usd, factors);
  const farm = farmStepsFor(record, factors);
  return { ...record, rank: 0, token_status: 'pre-token', watchlist, selection_group, ...factors, categoryFactor: factors.category_factor, growthFactor: factors.growth_factor, downsideFactor: factors.downside_factor, ageFactor: factors.age_factor, implied_value_usd, capital_usd: farm.capital_usd, hold_days: farm.hold_days, cadence: farm.cadence, farm_steps: farm.steps };
};

const liveRowFromRecord = (record: SnapshotProtocol, asOf: string, familyMedians: Map<string, number>, globalMedian: number, rank: number): LiveRow => {
  const factors = factorInputs(record, asOf, familyMedians, globalMedian);
  return { ...record, rank, token_status: 'token-bearing', ...factors, implied_value_usd: impliedValue(record.tvl_usd, factors) };
};

export const buildBoard = (input: SnapshotInput): { rows: BoardRow[]; live_market: LiveRow[]; stats: BoardStats; model: typeof MODEL_CONSTANTS } => {
  const records = input.protocols;
  const bySlug = new Map(records.map((record) => [record.slug, record]));
  const watchlistSet = new Set(input.watchlist);
  const rankable = records.filter(isRankable);
  const eligibleForStats = rankable;
  const globalMedian = median(eligibleForStats.map((record) => growthFor(record)));
  const valuesByFamily = new Map<string, number[]>();
  for (const record of eligibleForStats) {
    const family = familyForCategory(record.category);
    const values = valuesByFamily.get(family) ?? [];
    values.push(growthFor(record));
    valuesByFamily.set(family, values);
  }
  const familyMedians = new Map([...valuesByFamily.entries()].map(([family, values]) => [family, median(values)]));
  const watchRecords = input.watchlist.map((slug) => {
    const record = bySlug.get(slug);
    if (!record) throw new Error(`Watchlist slug missing from snapshot: ${slug}`);
    return record;
  });
  const earlyCapacity = 200 - watchRecords.length;
  const earlyCandidates = rankable
    .filter((record) => !watchlistSet.has(record.slug) && record.tvl_usd < input.floor_usd && !isProductFiltered(record))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
  const earlyRecords = earlyCandidates.slice(0, Math.min(160, earlyCapacity));
  const selected = new Set([...watchRecords, ...earlyRecords].map((record) => record.slug));
  const supplementalAboveCandidates = rankable
    .filter((record) => !selected.has(record.slug) && record.tvl_usd >= input.floor_usd && !isProductFiltered(record))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
  const supplementalAboveRecords = supplementalAboveCandidates.slice(0, Math.max(0, 200 - selected.size));
  supplementalAboveRecords.forEach((record) => selected.add(record.slug));
  const supplementalBelowCandidates = rankable
    .filter((record) => !selected.has(record.slug) && record.tvl_usd < input.floor_usd && !isProductFiltered(record))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
  const supplementalBelowRecords = supplementalBelowCandidates.slice(0, Math.max(0, 200 - selected.size));
  const supplementalRecords = [...supplementalAboveRecords, ...supplementalBelowRecords];
  const selectedRows = [
    ...watchRecords.map((record) => rowFromRecord(record, input.as_of, familyMedians, globalMedian, 'watchlist', true)),
    ...earlyRecords.map((record) => rowFromRecord(record, input.as_of, familyMedians, globalMedian, 'early-below-floor', false)),
    ...supplementalRecords.map((record) => rowFromRecord(record, input.as_of, familyMedians, globalMedian, 'supplemental', false)),
  ];
  if (selectedRows.length < 100 || selectedRows.length > 200) throw new Error(`Expected between 100 and 200 selected rows, received ${selectedRows.length}`);
  selectedRows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  selectedRows.forEach((row, index) => { row.rank = index + 1; });
  const liveRecords = records.filter((record) => !isPreToken(record)).sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
  const live_market = liveRecords.map((record, index) => liveRowFromRecord(record, input.as_of, familyMedians, globalMedian, index + 1));
  const stats: BoardStats = {
    watchlist_size: input.watchlist.length,
    watchlist_covered: selectedRows.filter((row) => row.watchlist).length,
    board_size: selectedRows.length,
    early_size: earlyRecords.length,
    supplemental_size: supplementalRecords.length,
    supplemental_above_floor: supplementalAboveRecords.length,
    supplemental_below_floor: supplementalBelowRecords.length,
    live_size: live_market.length,
    cex_count: selectedRows.filter((row) => row.category === 'CEX').length,
    versioned_count: selectedRows.filter((row) => isVersioned(row)).length,
    product_filtered_count: selectedRows.filter((row) => isProductFiltered(row)).length,
    early_below_floor_available: earlyCandidates.length,
  };
  return { rows: selectedRows, live_market, stats, model: MODEL_CONSTANTS };
};

export const validateBoard = (rows: BoardRow[], watchlist: string[]): void => {
  if (rows.length < 100 || rows.length > 200) throw new Error(`Board must contain between 100 and 200 rows, received ${rows.length}`);
  const slugs = new Set(rows.map((row) => row.slug));
  if (slugs.size !== rows.length) throw new Error('Board slugs must be unique');
  rows.forEach((row, index) => {
    if (row.rank !== index + 1) throw new Error(`Board rank mismatch at index ${index}`);
    if (index > 0 && row.implied_value_usd > rows[index - 1]!.implied_value_usd) throw new Error('Board implied values must be non-increasing');
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1) throw new Error(`Invalid implied value for ${row.slug}`);
    if (row.farm_steps.length !== 7 || row.farm_steps.some((step) => step.length < 20 || step.length > 600 || !step.includes('Cost:') || !step.includes('Time:'))) throw new Error(`Invalid farm plan for ${row.slug}`);
    const recomputed = impliedValue(row.tvl_usd, row);
    if (recomputed !== row.implied_value_usd) throw new Error(`Model mismatch for ${row.slug}`);
  });
  const missing = watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) throw new Error(`Watchlist coverage missing: ${missing.join(', ')}`);
};

export const modelValueForRow = (row: Pick<BoardRow, 'tvl_usd' | 'category_factor' | 'growth_factor' | 'downside_factor' | 'age_factor'>): number => impliedValue(row.tvl_usd, row);

export const selectionPredicates = { isPreToken, isVersioned, isRankable, isProductFiltered };
