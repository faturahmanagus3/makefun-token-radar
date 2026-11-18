// Launch Radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every protocol that records no token and is a launch candidate in its own right:
// every slug on the snapshot's watchlist (the floor, never the ceiling) plus every other pre-token
// protocol the product filter below lets through, at any TVL. Two sets are kept apart from the board
// and shown for what they are: protocols whose token already trades (the dashboard's Live view, at
// the market's own capitalisation) and products of a token that already trades (wrapped, staked or
// bridged versions of a live asset, exchange surfaces and older versions of a protocol), whose TVL
// is somebody else's asset passing through, not a future launch's own value.
//
// Implied value is one function of the snapshot's own figures, the same for every row:
//
//   implied = round( tvl_usd x category_multiple x growth_multiplier
//                    x maturity_multiplier x breadth_multiplier )
//
//   category_multiple   what a launched token in this line of business has historically been worth
//                       per dollar of TVL: fee-taking venues (exchanges, derivatives) highest,
//                       wrappers and infrastructure lowest. A property of the category, never of
//                       a protocol's name.
//   growth_multiplier   1 + 0.6 x clamp(change_7d, -50, 150) / 100: a week of growth lifts the
//                       claim, a week of shrinkage cuts it, and one wild week cannot dominate.
//   maturity_multiplier 0.55 + 0.45 x min(age_days, 1460) / 1460: the longer a protocol has run
//                       with no token, the more of its record a launch would capitalise. An
//                       unrecorded age counts as one year.
//   breadth_multiplier  1 + 0.05 x min(chains - 1, 4): a protocol already running on several
//                       chains launches to a wider market than a single-chain one.
//
// No protocol name is special-cased anywhere in this file: the same code scores, filters and
// writes the farm plan of every row from its category, chains, TVL, growth and age alone.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label, named in the dashboard and in every board row's breakdown. */
export const MODEL_VERSION = 'launch-radar-2';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 30;

/** How many set-aside products the dashboard names, by TVL. */
export const PRODUCT_ROWS = 14;

/** Categories whose launched tokens have carried the highest value per dollar of TVL. */
const MULT_HIGH = 0.4;
/** Categories with a proven fee or interest stream a token can claim a share of. */
const MULT_MID = 0.32;
/** Curators, allocators and asset managers: real revenue, thinner token claims on it. */
const MULT_LOW = 0.26;
/** Infrastructure and everything unlisted: a launch is possible, the claim on TVL weakest. */
const MULT_BASE = 0.2;

const HIGH_CATEGORIES = new Set(['Dexs', 'Derivatives', 'Interest Rate Derivatives']);
const MID_CATEGORIES = new Set([
  'Lending',
  'CDP',
  'CDP Manager',
  'Uncollateralized Lending',
  'Yield',
  'Yield Aggregator',
  'Basis Trading',
  'Leveraged Farming',
]);
const LOW_CATEGORIES = new Set([
  'Risk Curators',
  'Onchain Capital Allocator',
  'RWA',
  'Dual-Token Stablecoin',
  'Staking Pool',
  'Liquidity Manager',
  'Collateral Markets',
  'Indexes',
  'Farm',
]);

/**
 * Categories that are products of an asset that already trades, or an exchange's own surface:
 * their TVL is a live token's value in transit, so the radar sets them aside instead of ranking
 * them as future launches. This is the watchlist's own product rule, extended to the other
 * product categories DefiLlama names (cross-chain bridges, stablecoin wrappers, BTC products).
 */
const PRODUCT_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Stablecoin Wrapper',
  'Anchor BTC',
  'Decentralized BTC',
]);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped or staking product of another asset. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name are that exchange's product, not a launch candidate. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** The model's growth clamp, in per cent of TVL change over seven days. */
export const GROWTH_FLOOR = -50;
export const GROWTH_CAP = 150;
export const GROWTH_WEIGHT = 0.6;
/** The maturity curve: floor, range and the age at which it tops out, in days. */
export const MATURITY_FLOOR = 0.55;
export const MATURITY_RANGE = 0.45;
export const MATURITY_DAYS = 1460;
/** The age an unrecorded listing date counts as, in days. */
export const UNKNOWN_AGE_DAYS = 365;
/** The breadth curve: per extra chain, and how many extra chains count. */
export const BREADTH_STEP = 0.05;
export const BREADTH_MAX_EXTRA = 4;

/** One row of board.json: the ranked board's row, with the model's own arithmetic attached. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    version: string;
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: the row itself, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** A set-aside product: records no token of its own, but its TVL is a live asset in transit. */
export interface ProductRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  why: string;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: {
    growth_floor: number;
    growth_cap: number;
    growth_weight: number;
    maturity_floor: number;
    maturity_range: number;
    maturity_days: number;
    unknown_age_days: number;
    breadth_step: number;
    breadth_max_extra: number;
    multiples: { high: number; mid: number; low: number; base: number };
  };
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  product_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  products: ProductRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why a pre-token protocol is a product of a live token rather than a launch candidate, or null. */
export function productReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) {
    if (p.category === 'CEX') return 'an exchange surface: its TVL is customer balances, not a protocol waiting on a launch';
    if (p.category.includes('Bridge')) return 'a bridge product: its TVL is other assets in transit, already issued elsewhere';
    if (p.category.includes('Staking') || p.category.includes('Restaked')) return 'a staking product of an asset that already trades';
    return 'a wrapped product of an asset that already trades';
  }
  if (VERSIONED.test(p.name)) return 'a later version of another protocol, whose launch is the original\u2019s';
  if (PRODUCT_WORD.test(p.name)) return 'a wrapped or staking product of an asset that already trades';
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return 'an exchange\u2019s own product, not an independent launch candidate';
  return null;
}

/** Whether the board may rank a protocol: pre-token and not a product of a live token. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && productReason(p) === null;
}

/** The category multiple: what a launched token in this line of business is worth per TVL dollar. */
export function categoryMultiple(category: string | null): number {
  if (category !== null && HIGH_CATEGORIES.has(category)) return MULT_HIGH;
  if (category !== null && MID_CATEGORIES.has(category)) return MULT_MID;
  if (category !== null && LOW_CATEGORIES.has(category)) return MULT_LOW;
  return MULT_BASE;
}

/** The model's four multipliers and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const maturityMult = MATURITY_FLOOR + (Math.min(Math.max(ageForModel, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
  const breadthMult = 1 + BREADTH_STEP * Math.min(Math.max(protocol.chains.length - 1, 0), BREADTH_MAX_EXTRA);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * categoryMultiple(protocol.category) * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is ranked, whatever the filters say about it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The radar proper: every other pre-token protocol that is a launch candidate in its own right,
  // at any TVL. The floor is where the house's reading started, not where this one stops.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      version: MODEL_VERSION,
      category_multiple: categoryMultiple(s.p.category),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Roughly what one transaction and one week of activity cost on a chain, in dollars. */
function gasFor(chain: string): { setup: number; weekly: number } {
  switch (chain) {
    case 'Ethereum':
      return { setup: 10, weekly: 6 };
    case 'Solana':
    case 'Polygon':
      return { setup: 1, weekly: 1 };
    case 'Bitcoin':
      return { setup: 3, weekly: 2 };
    default:
      // Layer-2 networks and sidechains settle for cents; anything unlisted is priced cautiously.
      return { setup: 2, weekly: 1 };
  }
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The line of business a category belongs to, which chooses the farm playbook. */
type Playbook = 'lending' | 'dex' | 'perps' | 'vault' | 'rwa' | 'stake' | 'market' | 'generic';

function playbookOf(category: string | null): Playbook {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('liquidity')) return 'dex';
  if (c.includes('derivative') || c.includes('perpetual')) return 'perps';
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('basis') || c.includes('farm') || c.includes('index')) return 'vault';
  if (c.includes('rwa') || c.includes('cedefi') || c.includes('stablecoin')) return 'rwa';
  if (c.includes('staking') || c.includes('restak')) return 'stake';
  if (c.includes('prediction') || c.includes('insurance') || c.includes('payment') || c.includes('otc') || c.includes('card')) return 'market';
  return 'generic';
}

/** The playbook's core position: the one action that makes a wallet a real user of the protocol. */
function coreAction(book: Playbook, p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (book) {
    case 'lending':
      return `Supply $${capital} of USDC as collateral in ${name} on ${chain} and leave it supplied; a parked deposit with no borrow history is the weakest signal a lending market records.`;
    case 'dex':
      return `Add $${capital} of liquidity to the busiest USDC pair in ${name} on ${chain}, split evenly across both sides of the pool, and leave the position in range.`;
    case 'perps':
      return `Deposit $${capital} of USDC as margin in ${name} on ${chain} and open one small position, no larger than the deposit, so the account carries real trading history.`;
    case 'vault':
      return `Deposit $${capital} into the main ${name} vault on ${chain} and keep the vault shares in the same wallet; the shares are the record the position exists.`;
    case 'rwa':
      return `Complete ${name}'s onboarding on ${chain} and mint or deposit $${capital} of its yield asset, holding it in the same wallet you onboarded with.`;
    case 'stake':
      return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt in the wallet that staked.`;
    case 'market':
      return `Fund the wallet with $${capital} and complete one full use of ${name} on ${chain}: a position taken, a policy bought or a payment made, end to end.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open; use the wallet the deposit came from for everything that follows.`;
  }
}

/** The playbook's second action: the behaviour that separates a user from a parked balance. */
function secondAction(book: Playbook, p: SnapshotProtocol, capital: number): string {
  const name = p.name;
  switch (book) {
    case 'lending':
      return `Borrow about 40 per cent of the collateral's value, hold the borrow for a few days, then repay in full; repeat the cycle monthly so the account shows borrowing, not just supply.`;
    case 'dex':
      return `Swap about $${Math.max(25, Math.round(capital / 2))} through ${name} twice a week in both directions, so the wallet reads as a trader who also provides liquidity, not a one-off deposit.`;
    case 'perps':
      return `Trade small hedged volume every week, about $${capital} of notional in total, and keep each position modest; steady volume over weeks counts for more than one large trade.`;
    case 'vault':
      return `Top the vault position up by about 10 per cent each month, or rotate a small part of it between ${name}'s vaults, so the account shows ongoing allocation rather than a single deposit.`;
    case 'rwa':
      return `Claim or compound the yield the position earns at each distribution instead of letting it sit unclaimed, and keep the claim transactions in the same wallet.`;
    case 'stake':
      return `Take part in one governance or validator choice ${name} offers each month, and restake or extend the position once before the hold ends so the stake reads as committed.`;
    case 'market':
      return `Repeat the core use about once a week at a small size, varying the amount slightly each time, so the history looks like a person's habit rather than a script's loop.`;
    default:
      return `Make one more core action in ${name} each week, such as a deposit, a withdrawal of a small part, or a vote, so the wallet's history spans the whole hold, not one day.`;
  }
}

/** One farm step as a single string: the action, then its cost and its time. */
function step(action: string, cost: string, time: string): string {
  let s = `${action} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) {
    // Cut at a word boundary, never mid-word, and stay inside the gate's 600 characters.
    const cut = s.slice(0, 596);
    s = `${cut.slice(0, cut.lastIndexOf(' '))}...`;
  }
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const book = playbookOf(p.category);
  return [
    step(
      `Set up a fresh wallet for ${p.name} and fund it on ${chain} with the position money plus about $${gas.setup + 4} for fees; keep the seed phrase offline and never farm from an exchange deposit address.`,
      `about $${gas.setup + 4} of network fees to fund`,
      '10 minutes',
    ),
    step(coreAction(book, p, capital, chain), `$${capital} of capital and about $${gas.setup} of gas`, '20 minutes to set up'),
    step(secondAction(book, p, capital), `about $${gas.weekly} of gas a week`, '10 minutes a week'),
    step(
      `Hold the position for at least ${hold} days so the activity appears in more than one weekly snapshot of ${p.name}; closing early and reopening resets most of what the hold proves.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    step(
      `Open ${p.name}'s own points or rewards page from inside its app, never from a search result or a message link, and check what the wallet has accrued before changing anything.`,
      'nothing to check, and never pay anyone to claim',
      '10 minutes',
    ),
    step(
      `Write the wallet address, the dates, the amounts and every transaction hash in a farm log, so the position can be repeated, extended or unwound without guessing.`,
      'nothing but the log',
      '5 minutes',
    ),
    step(
      `To exit, unwind in reverse order (repay, withdraw, then bridge back) in one sitting, and leave the wallet untouched afterwards in case a later snapshot still counts it.`,
      `about $${gas.setup} of gas to unwind`,
      '20 minutes',
    ),
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** The set-aside products, by TVL, with the reason each was set aside. */
export function productRows(snapshot: Snapshot): ProductRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && productReason(p) !== null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, PRODUCT_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, why: productReason(p)! }));
}

/** A board row's form for data.js: the row itself, farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const products = productRows(snapshot);
  const productTotal = snapshot.protocols.filter((p) => isPreToken(p) && productReason(p) !== null).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: {
      growth_floor: GROWTH_FLOOR,
      growth_cap: GROWTH_CAP,
      growth_weight: GROWTH_WEIGHT,
      maturity_floor: MATURITY_FLOOR,
      maturity_range: MATURITY_RANGE,
      maturity_days: MATURITY_DAYS,
      unknown_age_days: UNKNOWN_AGE_DAYS,
      breadth_step: BREADTH_STEP,
      breadth_max_extra: BREADTH_MAX_EXTRA,
      multiples: { high: MULT_HIGH, mid: MULT_MID, low: MULT_LOW, base: MULT_BASE },
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    product_size: productTotal,
    rows: board.map(radarRow),
    live,
    products,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board names a slug twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${i} carries rank ${r.rank}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
