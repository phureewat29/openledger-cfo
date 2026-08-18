import type { AccountCreateInput } from "@openledger-cfo/openledger";

import type { Instrument } from "./products/securities";
import { ACCOUNT, unitAccountsOf } from "./accounts";
import { PERSONA } from "./persona";
import { BANKS } from "./products/banks";
import { CARDS } from "./products/cards";
import { LOANS } from "./products/loans";
import {
  COINS,
  HOLDINGS,
  INSTRUMENTS,
  THAI_FUNDS,
} from "./products/securities";

const BROKER = "Interactive Brokers";

const asset = (
  id: string,
  name: string,
  extra: Partial<AccountCreateInput> = {},
): AccountCreateInput => ({ id, name, type: "asset", ...extra });
const liability = (
  id: string,
  name: string,
  extra: Partial<AccountCreateInput> = {},
): AccountCreateInput => ({ id, name, type: "liability", ...extra });
const income = (id: string, name: string): AccountCreateInput => ({
  id,
  name,
  type: "income",
});
const expense = (id: string, name: string): AccountCreateInput => ({
  id,
  name,
  type: "expense",
});
const equity = (
  id: string,
  name: string,
  extra: Partial<AccountCreateInput> = {},
): AccountCreateInput => ({ id, name, type: "equity", ...extra });

const BANK_ACCOUNTS: AccountCreateInput[] = BANKS.map((bank) =>
  asset(bank.account, bank.name, {
    subtype: "bank",
    bank_name: bank.bankName,
    account_number_masked: bank.masked,
    metadata: { annual_rate: bank.annualRate, interest: bank.cadence },
  }),
);

const CARD_ACCOUNTS: AccountCreateInput[] = CARDS.map((card) =>
  liability(card.account, card.name, {
    subtype: "credit_card",
    bank_name: card.bankName,
    account_number_masked: card.masked,
    statement_day: card.statementDay,
    due_day: card.dueDay,
  }),
);

const LOAN_ACCOUNTS: AccountCreateInput[] = LOANS.map((loan) =>
  liability(loan.account, loan.name, {
    subtype: "loan",
    bank_name: loan.bankName,
    metadata: { category: loan.category, schedule: loan.kind },
  }),
);

/**
 * What a reader needs to get from the money a position cost to the quantity it
 * bought. The pointer is declared on the account rather than inferred from the
 * id, so nothing downstream has to know how a ticker maps onto a unit head.
 */
const positionMetadata = (
  instrument: Instrument,
  kind: string,
): Record<string, unknown> => ({
  ticker: instrument.ticker,
  kind,
  unit: instrument.unit,
  unit_scale: instrument.unitScale,
  unit_account: unitAccountsOf(instrument.unit).position,
});

const HOLDING_ACCOUNTS: AccountCreateInput[] = HOLDINGS.map((holding) =>
  asset(holding.account, holding.name, {
    subtype: holding.kind,
    bank_name: BROKER,
    metadata: { ...positionMetadata(holding, holding.kind), dps: holding.dps },
  }),
);

/** SSF and RMF are funds the tax code treats apart, and the id says so. */
const fundSubtype = (accountId: string): string =>
  accountId.split(":")[2] ?? "fund";

const FUND_ACCOUNTS: AccountCreateInput[] = THAI_FUNDS.map((fund) =>
  asset(fund.account, fund.name, {
    subtype: fundSubtype(fund.account),
    metadata: positionMetadata(fund, "fund"),
  }),
);

const COIN_ACCOUNTS: AccountCreateInput[] = COINS.map((coin) =>
  asset(coin.account, coin.name, {
    subtype: "crypto",
    metadata: positionMetadata(coin, "crypto"),
  }),
);

/**
 * One ledger per instrument, denominated in the instrument itself. Its head is
 * not a currency and never enters a report: quantity and money meet only inside
 * a transaction group, where the two legs together state a price.
 */
const UNIT_ACCOUNTS: AccountCreateInput[] = INSTRUMENTS.flatMap(
  (instrument) => {
    const unit = unitAccountsOf(instrument.unit);
    return [
      asset(unit.position, `${instrument.ticker} Units`, {
        subtype: "unit",
        metadata: {
          kind: "unit",
          ticker: instrument.ticker,
          unit_of: instrument.account,
          unit_scale: instrument.unitScale,
        },
      }),
      equity(unit.equity, `${instrument.ticker} Units — Conversion`, {
        metadata: { kind: "unit" },
      }),
    ];
  },
);

const EXPENSES: AccountCreateInput[] = [
  expense(ACCOUNT.groceries, "Groceries"),
  expense(ACCOUNT.restaurants, "Restaurants"),
  expense(ACCOUNT.coffee, "Coffee"),
  expense(ACCOUNT.delivery, "Food Delivery"),
  expense(ACCOUNT.fineDining, "Fine Dining"),

  expense(ACCOUNT.btsMrt, "BTS / MRT"),
  expense(ACCOUNT.fuel, "Fuel"),
  expense(ACCOUNT.grab, "Grab Rides"),
  expense(ACCOUNT.tolls, "Expressway Tolls"),
  expense(ACCOUNT.parking, "Parking"),

  expense(ACCOUNT.condoFee, "Condo Common Fee"),
  expense(ACCOUNT.maintenance, "Home Maintenance"),
  expense(ACCOUNT.houseUpkeep, "House Upkeep"),

  expense(ACCOUNT.housekeeper, "Housekeeper"),
  expense(ACCOUNT.gardening, "Gardening & Pool"),
  expense(ACCOUNT.laundry, "Laundry & Pressing"),

  expense(ACCOUNT.mortgageInterest, "Mortgage Interest"),
  expense(ACCOUNT.carInterest, "Car Loan Interest"),
  expense(ACCOUNT.personalInterest, "Personal Loan Interest"),
  expense(ACCOUNT.cardInterest, "Credit Card Interest"),

  expense(ACCOUNT.electricity, "Electricity (MEA)"),
  expense(ACCOUNT.water, "Water (MWA)"),
  expense(ACCOUNT.internet, "Home Internet"),
  expense(ACCOUNT.mobile, "Mobile"),

  expense(ACCOUNT.streaming, "Streaming"),
  expense(ACCOUNT.software, "Software"),
  expense(ACCOUNT.fitness, "Fitness"),

  expense(ACCOUNT.shoppingOnline, "Online Shopping"),
  expense(ACCOUNT.clothing, "Clothing"),
  expense(ACCOUNT.electronics, "Electronics"),
  expense(ACCOUNT.homeGoods, "Home & Living"),
  expense(ACCOUNT.departmentStore, "Department Stores"),

  expense(ACCOUNT.pharmacy, "Pharmacy"),
  expense(ACCOUNT.clinic, "Clinic & Hospital"),
  expense(ACCOUNT.dental, "Dental"),

  expense(ACCOUNT.healthInsurance, "Health Insurance"),
  expense(ACCOUNT.carInsurance, "Car Insurance"),
  expense(ACCOUNT.condoInsurance, "Property Insurance"),
  expense(ACCOUNT.lifeInsurance, "Life Insurance"),

  expense(ACCOUNT.golf, "Golf"),
  expense(ACCOUNT.entertainment, "Entertainment"),

  expense(ACCOUNT.flights, "Flights"),
  expense(ACCOUNT.hotels, "Hotels"),
  expense(ACCOUNT.travelDining, "Travel Dining"),
  expense(ACCOUNT.travelShopping, "Travel Shopping"),

  expense(ACCOUNT.incomeTax, "Income Tax"),
  expense(ACCOUNT.socialSecurity, "Social Security"),
  expense(ACCOUNT.withholdingTax, "Withholding Tax"),

  expense(ACCOUNT.allowance, "Family Allowance"),
  expense(ACCOUNT.familyMedical, "Family Medical"),
  expense(ACCOUNT.familyUtilities, "Family Utilities"),

  expense(ACCOUNT.donation, "Donation"),

  expense(ACCOUNT.bankFees, "Bank Fees"),
  expense(ACCOUNT.fxFees, "FX Fees"),
  expense(ACCOUNT.brokerageFees, "Remittance & Brokerage Fees"),
];

/** One authority for every account the ledger is bootstrapped with. */
export const CHART: AccountCreateInput[] = [
  ...BANK_ACCOUNTS,
  asset(ACCOUNT.cash, "Cash", { subtype: "cash" }),
  asset(ACCOUNT.truemoney, "TrueMoney Wallet", { subtype: "wallet" }),
  asset(ACCOUNT.pvd, "Provident Fund", { subtype: "investment" }),
  ...FUND_ACCOUNTS,
  ...COIN_ACCOUNTS,
  asset(ACCOUNT.condo, "Life Asoke - Rama 9 (1BR+ 45 sqm)", {
    subtype: "real_estate",
  }),
  asset(ACCOUNT.house, "Family House — Khon Kaen", { subtype: "real_estate" }),

  ...CARD_ACCOUNTS,
  ...LOAN_ACCOUNTS,

  income(ACCOUNT.salary, `Salary — ${PERSONA.employer}`),
  income(ACCOUNT.bonus, "Bonus"),
  income(ACCOUNT.consulting, "Freelance"),
  income(ACCOUNT.interestIncome, "Interest Income"),
  income(ACCOUNT.dividendTHB, "Dividend Income"),
  income(ACCOUNT.realizedGain, "Realized Investment Gain"),

  ...EXPENSES,

  equity(ACCOUNT.openingTHB, "Opening Balance (THB)"),
  equity(ACCOUNT.conversionTHB, "Currency Conversion (THB)"),

  // The USD ledger only exists once its accounts do; opening and conversion are explicit.
  asset(ACCOUNT.brokerageCash, "IBKR Cash", {
    subtype: "brokerage",
    bank_name: BROKER,
  }),
  ...HOLDING_ACCOUNTS,
  income(ACCOUNT.dividendUSD, "Dividend Income (USD)"),
  income(ACCOUNT.realizedGainUSD, "Realized Investment Gain (USD)"),
  equity(ACCOUNT.openingUSD, "Opening Balance (USD)"),
  equity(ACCOUNT.conversionUSD, "Currency Conversion (USD)"),

  ...UNIT_ACCOUNTS,
];
