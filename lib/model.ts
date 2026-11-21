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

export interface BoardRow extends SnapshotProtocol {
  token_status: 'pre-token';
  age_days: number;
  growth_pct: number;
  growth_multiplier: number;
  age_multiplier: number;
  status_multiplier: number;
  implied_value_usd: number;
  farm_steps: string[];
  rank: number;
}

export interface LiveRow extends SnapshotProtocol {
  token_status: 'token-bearing';
  age_days: number;
  growth_pct: number;
}

const DAY = 86_400_000;
const categories = {
  lending: ['lending', 'credit', 'cdp', 'money market'],
  dex: ['dex', 'amm', 'spot', 'order book'],
  derivatives: ['derivative', 'perp', 'options', 'futures'],
  restaking: ['restaking', 'liquid staking', 'staking pool', 'staking'],
  bridge: ['bridge', 'cross chain'],
  vault: ['vault', 'allocator', 'curator', 'liquidity manager'],
  yield: ['yield', 'farm', 'basis', 'synthetic'],
};

function family(category: string): keyof typeof categories | 'general' {
  const c = category.toLowerCase();
  for (const [key, terms] of Object.entries(categories)) {
    if (terms.some((term) => c.includes(term))) return key as keyof typeof categories;
  }
  return 'general';
}

function ageDays(asOf: string, listedAt: string | null): number {
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = listedAt ? Date.parse(`${listedAt}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(end) || !Number.isFinite(start)) return 365;
  return Math.max(0, Math.floor((end - start) / DAY));
}

function modelInputs(p: SnapshotProtocol, asOf: string) {
  const age_days = ageDays(asOf, p.listed_at);
  const growth_pct = p.change_7d == null ? 0 : Math.max(-60, Math.min(120, p.change_7d));
  const growth_multiplier = 1 + 0.4 * growth_pct / 100;
  const age_multiplier = 0.7 + 0.3 * Math.min(age_days, 1095) / 1095;
  const status_multiplier = p.gecko_id === null && p.symbol === null ? 1 : 0.55;
  const implied_value_usd = Math.max(1, Math.round(p.tvl_usd * 0.3 * growth_multiplier * age_multiplier * status_multiplier));
  return { age_days, growth_pct, growth_multiplier, age_multiplier, status_multiplier, implied_value_usd };
}

function money(n: number): string {
  if (n < 1) return '$0';
  if (n < 1000) return `$${Math.round(n)}`;
  return `$${Math.round(n / 100) * 100}`;
}

function templates(kind: keyof typeof categories | 'general', p: SnapshotProtocol, model: ReturnType<typeof modelInputs>): string[] {
  const chain = p.chains[0] ?? 'the first supported chain';
  const base = Math.max(4, Math.min(45, Math.round(Math.log10(Math.max(10, p.tvl_usd)) * 2)));
  const cadence = model.age_days < 45 ? 'within 48 hours' : 'once each week';
  const common = [
    `Set up and verify — Open ${p.name} on ${chain}, connect a fresh wallet, and record the exact network and contract shown for ${p.slug}. Expected cost ${money(base)} for gas and setup. Time requirement 15–25 minutes.`,
    `Start with a measured position — Use a test-sized position of $${Math.max(25, base * 5)} in ${p.name} and keep the transaction hash, amount, and block time in a tracker. Expected cost ${money(base + 2)} including network fees. Time requirement 20–35 minutes.`,
    `Repeat and document — Review ${p.name} ${cadence}, compare balance and risk settings with the prior entry, and save a dated screenshot or export. Expected cost ${money(Math.max(0, base - 2))} for observation and gas. Time requirement 10–20 minutes.`,
    `Record a claim-ready trail — Keep wallet address, ${p.slug} page, action hashes, deposited value, and withdrawal status together so any future points or launch claim can be checked from primary evidence. Expected cost $0. Time requirement 10–15 minutes.`,
  ];
  const specialized: Record<string, string[]> = {
    lending: [`Supply or borrow — Supply a small stablecoin amount to ${p.name}; if collateral rules allow, test one conservative borrow and immediately note health factor and repayment path. Expected cost ${money(base + 3)} in capital and gas. Time requirement 25–40 minutes.`],
    dex: [`Provide useful liquidity — Make one small swap on ${p.name}, then add a narrow, reversible liquidity position only if the pool shows adequate volume. Expected cost ${money(base + 4)} for swap, LP capital, and gas. Time requirement 30–45 minutes.`],
    derivatives: [`Run a bounded trade test — Read ${p.name} funding, margin, and liquidation rules, then place a minimal isolated position with a written stop and close it in the same session. Expected cost ${money(base + 5)} for margin and fees. Time requirement 30–50 minutes.`],
    restaking: [`Stake and inspect withdrawal — Stake a small amount through ${p.name}, capture validator or operator selection, and verify the displayed withdrawal queue before adding more. Expected cost ${money(base + 3)} for gas and stake movement. Time requirement 25–40 minutes.`],
    bridge: [`Bridge a small amount — Bridge a test amount from ${chain} to the next supported chain, record source and destination hashes, and confirm the received balance before repeating. Expected cost ${money(base + 6)} for bridge and gas. Time requirement 35–60 minutes.`],
    vault: [`Deposit and inspect strategy — Deposit a measured amount into ${p.name}, read the strategy and withdrawal notice, then verify share price and exit quote before increasing exposure. Expected cost ${money(base + 3)} for deposit and gas. Time requirement 25–45 minutes.`],
    yield: [`Test the yield loop — Complete one small deposit or farm action on ${p.name}, record displayed APY, lock period, reward asset, and exit fee, then schedule the next check. Expected cost ${money(base + 4)} for capital and gas. Time requirement 30–45 minutes.`],
    general: [`Map the core action — Identify the primary deposit, swap, stake, or service action exposed by ${p.name}, complete it with a capped amount, and save the fee and receipt. Expected cost ${money(base + 2)} in gas or service fees. Time requirement 20–35 minutes.`],
  };
  return [common[0]!, specialized[kind]![0]!, common[1]!, common[2]!, common[3]!];
}

export function buildBoard(snapshot: { as_of: string; floor_usd: number; protocols: SnapshotProtocol[]; watchlist: string[] }): { rows: BoardRow[]; live_market: LiveRow[] } {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const rankable = snapshot.protocols.filter((p) => p.gecko_id === null && p.symbol === null);
  const selected = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p && p.gecko_id === null && p.symbol === null) selected.set(slug, p);
  }
  const below = rankable.filter((p) => p.tvl_usd < snapshot.floor_usd && !selected.has(p.slug)).sort((a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
  for (const p of below) {
    if (selected.size >= snapshot.watchlist.length + 160) break;
    selected.set(p.slug, p);
  }
  if (selected.size < snapshot.watchlist.length + 160) {
    for (const p of [...rankable].sort((a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug))) {
      if (selected.size >= snapshot.watchlist.length + 160) break;
      selected.set(p.slug, p);
    }
  }
  const rows = [...selected.values()].map((p) => {
    const model = modelInputs(p, snapshot.as_of);
    return { ...p, ...model, token_status: 'pre-token' as const, farm_steps: templates(family(p.category), p, model), rank: 0 };
  }).sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug)).map((row, i) => ({ ...row, rank: i + 1 }));
  const live_market = snapshot.protocols.filter((p) => !(p.gecko_id === null && p.symbol === null)).map((p) => ({ ...p, ...modelInputs(p, snapshot.as_of), token_status: 'token-bearing' as const })).sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || a.slug.localeCompare(b.slug));
  return { rows, live_market };
}

export function validateBoard(rows: BoardRow[], watchlist: string[]): void {
  if (rows.length < 100 || rows.length > 4000) throw new Error(`board row count ${rows.length} outside gate`);
  const ranks = rows.map((r) => r.rank);
  if (ranks.some((r, i) => r !== i + 1)) throw new Error('board ranks are not exactly 1..N');
  if (rows.some((r, i) => i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd)) throw new Error('board values rise with rank');
  if (new Set(rows.map((r) => r.implied_value_usd)).size < 2) throw new Error('board values are all equal');
  if (watchlist.some((slug) => !rows.some((r) => r.slug === slug))) throw new Error('watchlist coverage failed');
  for (const row of rows) for (const step of row.farm_steps) if (step.trim().length < 20 || step.trim().length > 600) throw new Error(`farm step length failed for ${row.slug}`);
}
