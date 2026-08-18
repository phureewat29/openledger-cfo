import { z } from "zod/v4";

import { accountIdSchema } from "@openledger-cfo/openledger";

import { ACCOUNT } from "../accounts";
import { satang } from "../money";

/**
 * Six prices per instrument, read at 2024-09, 2024-12, 2025-04, 2025-08,
 * 2025-12 and 2026-08. Everything between them is interpolated, so a table this
 * short still gives every month of the window its own price.
 */
const anchorsSchema = z.array(z.number()).length(6);

/** A unit ledger's head. The id grammar allows three letters there and no digits. */
const unitCodeSchema = z
  .string()
  .regex(/^[a-z]{3}$/, "Expected a three-letter unit code");

/**
 * What every priced instrument has in common, whatever asset class it sits in:
 * an account that holds its cost, a unit ledger that holds its quantity, and a
 * price curve that ties the two together on any given day.
 */
export interface Instrument {
  readonly account: string;
  readonly ticker: string;
  readonly unit: string;
  /**
   * Quantity multiplier for the unit leg. A ledger amount stops at two decimals,
   * so a coin is recorded in thousandths and a share one for one.
   */
  readonly unitScale: number;
  readonly anchors: readonly number[];
  /** Cost of the position the persona already held when the window opened. */
  readonly opening: number;
}

export const holdingSchema = z.object({
  account: accountIdSchema,
  ticker: z.string(),
  name: z.string(),
  kind: z.enum(["stock", "etf"]),
  unit: unitCodeSchema,
  unitScale: z.number(),
  /** Declared annual dividend per share; a quarter of it is what a payout pays. */
  dps: z.number(),
  opening: z.number(),
  anchors: anchorsSchema,
});

export type Holding = z.infer<typeof holdingSchema>;

/**
 * Columns: account, ticker, name, kind, unit code, annual dividend per share,
 * opening cost, price anchors. The dividends are the real payouts of these
 * issuers — the mega-cap growth names pay almost nothing and the bank and the
 * broad-market fund carry the portfolio's income.
 */
const HOLDING_ROWS = [
  [
    ACCOUNT.stockAapl,
    "AAPL",
    "Apple Inc.",
    "stock",
    "apl",
    1.0,
    9_500,
    [225, 250, 200, 232, 270, 258],
  ],
  [
    ACCOUNT.stockMsft,
    "MSFT",
    "Microsoft Corp.",
    "stock",
    "msf",
    3.32,
    8_200,
    [430, 440, 380, 500, 480, 500],
  ],
  [
    ACCOUNT.stockNvda,
    "NVDA",
    "NVIDIA Corp.",
    "stock",
    "nvd",
    0.04,
    6_400,
    [108, 135, 110, 175, 185, 190],
  ],
  [
    ACCOUNT.stockGoogl,
    "GOOGL",
    "Alphabet Inc.",
    "stock",
    "gog",
    0.84,
    0,
    [160, 190, 155, 195, 285, 310],
  ],
  [
    ACCOUNT.stockAmzn,
    "AMZN",
    "Amazon.com Inc.",
    "stock",
    "amz",
    0,
    0,
    [185, 225, 175, 230, 240, 250],
  ],
  [
    ACCOUNT.stockMeta,
    "META",
    "Meta Platforms Inc.",
    "stock",
    "mta",
    2.1,
    0,
    [560, 600, 500, 720, 640, 680],
  ],
  [
    ACCOUNT.stockTsla,
    "TSLA",
    "Tesla Inc.",
    "stock",
    "tsl",
    0,
    0,
    [250, 460, 240, 320, 430, 400],
  ],
  [
    ACCOUNT.stockAvgo,
    "AVGO",
    "Broadcom Inc.",
    "stock",
    "avg",
    2.36,
    0,
    [170, 240, 180, 300, 370, 360],
  ],
  [
    ACCOUNT.stockV,
    "V",
    "Visa Inc.",
    "stock",
    "vsa",
    2.36,
    0,
    [275, 315, 330, 355, 340, 350],
  ],
  [
    ACCOUNT.stockJpm,
    "JPM",
    "JPMorgan Chase & Co.",
    "stock",
    "jpm",
    5.6,
    0,
    [210, 240, 230, 290, 300, 320],
  ],
  [
    ACCOUNT.etfVoo,
    "VOO",
    "Vanguard S&P 500 ETF",
    "etf",
    "voo",
    6.97,
    22_000,
    [520, 540, 480, 570, 620, 640],
  ],
] as const;

export const HOLDINGS: Holding[] = HOLDING_ROWS.map(
  ([account, ticker, name, kind, unit, dps, opening, anchors]) => ({
    account,
    ticker,
    name,
    kind,
    unit,
    unitScale: 1,
    dps,
    opening,
    anchors: [...anchors],
  }),
);

/** Issuers declare a yearly rate and pay a quarter of it at a time. */
export const perShareOf = (holding: Holding): number => satang(holding.dps / 4);

export const dividendOn = (holding: Holding, quantity: number): number =>
  satang(quantity * perShareOf(holding));

const fundBase = {
  account: accountIdSchema,
  ticker: z.string(),
  name: z.string(),
  unit: unitCodeSchema,
  unitScale: z.number(),
  payFrom: accountIdSchema,
  opening: z.number(),
  anchors: anchorsSchema,
};

/** Bought in four slices a month, the way a Thai broker's auto-invest is set up. */
const dcaFundSchema = z.object({
  ...fundBase,
  kind: z.literal("dca"),
  dcaMin: z.number(),
  dcaMax: z.number(),
  /** Declared annual distribution per unit; an accumulating fund declares zero. */
  dps: z.number(),
});

type DcaFund = z.infer<typeof dcaFundSchema>;

/**
 * SSF and RMF buy tax relief rather than exposure, and the relief is claimed
 * against a calendar year, so the whole allowance goes in one December lump.
 */
const taxFundSchema = z.object({
  ...fundBase,
  kind: z.literal("tax"),
  lump: z.number(),
});

export const thaiFundSchema = z.discriminatedUnion("kind", [
  dcaFundSchema,
  taxFundSchema,
]);

export type ThaiFund = z.infer<typeof thaiFundSchema>;

export const THAI_FUNDS: ThaiFund[] = [
  {
    kind: "dca",
    account: ACCOUNT.fundKChange,
    ticker: "K-CHANGE",
    name: "K Positive Change Equity — A",
    unit: "kch",
    unitScale: 1,
    payFrom: ACCOUNT.bbl,
    dcaMin: 15_000,
    dcaMax: 20_000,
    dps: 0,
    opening: 380_000,
    anchors: [14.2, 15.0, 13.1, 15.8, 16.4, 17.0],
  },
  {
    kind: "dca",
    account: ACCOUNT.fundScbSet50,
    ticker: "SCBSET50",
    name: "SCB SET50 Index Fund",
    unit: "set",
    unitScale: 1,
    payFrom: ACCOUNT.bbl,
    dcaMin: 15_000,
    dcaMax: 20_000,
    dps: 0.7,
    opening: 290_000,
    anchors: [18.9, 17.6, 16.2, 17.4, 18.2, 19.0],
  },
  {
    kind: "dca",
    account: ACCOUNT.fundEsGlobal,
    ticker: "ES-GINNO",
    name: "Eastspring Global Innovation",
    unit: "esg",
    unitScale: 1,
    payFrom: ACCOUNT.bbl,
    dcaMin: 15_000,
    dcaMax: 20_000,
    dps: 0,
    opening: 180_000,
    anchors: [10.4, 11.6, 9.8, 12.4, 13.2, 13.8],
  },
  {
    kind: "tax",
    account: ACCOUNT.ssf,
    ticker: "K-CHANGE-SSF",
    name: "K Positive Change Equity SSF",
    unit: "kss",
    unitScale: 1,
    payFrom: ACCOUNT.ttbMe,
    lump: 200_000,
    opening: 420_000,
    anchors: [14.1, 15.0, 13.2, 16.2, 17.3, 18.0],
  },
  {
    kind: "tax",
    account: ACCOUNT.rmf,
    ticker: "KS50RMF",
    name: "K SET50 RMF",
    unit: "krm",
    unitScale: 1,
    payFrom: ACCOUNT.ttbMe,
    lump: 100_000,
    opening: 260_000,
    anchors: [23.5, 21.9, 20.1, 21.6, 22.6, 23.6],
  },
];

/** A Thai index fund pays twice a year, so a payout is half the declared rate. */
const PAYOUTS_PER_YEAR = 2;

export const perUnitOf = (fund: DcaFund): number =>
  satang(fund.dps / PAYOUTS_PER_YEAR);

export const distributionOn = (fund: DcaFund, quantity: number): number =>
  satang(quantity * perUnitOf(fund));

export const coinSchema = z.object({
  account: accountIdSchema,
  ticker: z.string(),
  name: z.string(),
  unit: unitCodeSchema,
  unitScale: z.number(),
  buyMin: z.number(),
  buyMax: z.number(),
  opening: z.number(),
  /** Baht per whole coin: the dollar cycle carried across at the month's rate. */
  anchors: anchorsSchema,
});

export type Coin = z.infer<typeof coinSchema>;

const COIN_SCALE = 1_000;

export const COINS: Coin[] = [
  {
    account: ACCOUNT.cryptoBtc,
    ticker: "BTC",
    name: "Bitcoin",
    unit: "btc",
    unitScale: COIN_SCALE,
    buyMin: 10_000,
    buyMax: 25_000,
    opening: 240_000,
    anchors: [2_020_000, 3_330_000, 3_010_000, 4_225_000, 3_255_000, 3_875_000],
  },
  {
    account: ACCOUNT.cryptoEth,
    ticker: "ETH",
    name: "Ethereum",
    unit: "eth",
    unitScale: COIN_SCALE,
    buyMin: 10_000,
    buyMax: 20_000,
    opening: 120_000,
    anchors: [83_500, 119_000, 63_800, 132_500, 108_500, 125_500],
  },
  {
    account: ACCOUNT.cryptoSol,
    ticker: "SOL",
    name: "Solana",
    unit: "sol",
    unitScale: COIN_SCALE,
    buyMin: 10_000,
    buyMax: 18_000,
    opening: 60_000,
    anchors: [4_700, 7_365, 4_250, 6_800, 5_065, 6_275],
  },
];

/** Every instrument the chart has to open a unit ledger for. */
export const INSTRUMENTS: Instrument[] = [...HOLDINGS, ...THAI_FUNDS, ...COINS];

/**
 * A disposal names the quantity it sells, not the money it raises: the price on
 * the day decides the proceeds and the cost basis released decides the gain.
 * Sales never reach the dataset schema, so this stays a plain shape.
 */
interface Sale {
  readonly account: string;
  readonly ticker: string;
  readonly date: string;
  /** Share of the units held on the sale date that is disposed of. */
  readonly unitsFraction: number;
  readonly toAccount: string;
}

/**
 * Two dated where the cycle was kind and one dated where it was not: the spring
 * 2025 trough sits below every price the position was built at, so that sale
 * releases more cost than it raises and the loss is real rather than staged.
 */
export const CRYPTO_SALES: Sale[] = [
  {
    account: ACCOUNT.cryptoEth,
    ticker: "ETH",
    date: "2025-04-09",
    unitsFraction: 0.35,
    toAccount: ACCOUNT.kbank,
  },
  {
    account: ACCOUNT.cryptoBtc,
    ticker: "BTC",
    date: "2025-07-18",
    unitsFraction: 0.35,
    toAccount: ACCOUNT.kbank,
  },
  {
    account: ACCOUNT.cryptoEth,
    ticker: "ETH",
    date: "2026-03-12",
    unitsFraction: 0.4,
    toAccount: ACCOUNT.kbank,
  },
];

/** The one equity the persona trims, into a run that had gone far enough. */
export const STOCK_SALES: Sale[] = [
  {
    account: ACCOUNT.stockTsla,
    ticker: "TSLA",
    date: "2026-02-18",
    unitsFraction: 0.25,
    toAccount: ACCOUNT.brokerageCash,
  },
];
