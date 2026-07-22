/**
 * One authority for every account id the seed may touch. Ids only: the account
 * definitions that carry names and metadata are assembled in `chart.ts`, which
 * reads this table and the product tables that reference it. Keeping ids free of
 * imports is what lets a product table name its own accounts without a cycle.
 */
export const ACCOUNT = {
  kbank: "thb:asset:bank:kbank",
  scb: "thb:asset:bank:scb",
  bbl: "thb:asset:bank:bbl",
  bay: "thb:asset:bank:bay",
  ktb: "thb:asset:bank:ktb",
  ttbMe: "thb:asset:bank:ttb-me",
  uob: "thb:asset:bank:uob",

  cash: "thb:asset:cash:wallet",
  truemoney: "thb:asset:wallet:truemoney",

  pvd: "thb:asset:investment:pvd",
  ssf: "thb:asset:investment:ssf",
  rmf: "thb:asset:investment:rmf",

  fundKChange: "thb:asset:fund:k-change",
  fundScbSet50: "thb:asset:fund:scbset50",
  fundEsGlobal: "thb:asset:fund:es-global",

  cryptoBtc: "thb:asset:crypto:btc",
  cryptoEth: "thb:asset:crypto:eth",
  cryptoSol: "thb:asset:crypto:sol",

  condo: "thb:asset:real-estate:condo",
  house: "thb:asset:real-estate:house",

  cardKbankVisa: "thb:liability:credit_card:kbank-visa",
  cardTtbAbsolute: "thb:liability:credit_card:ttb-absolute",
  cardScbUp: "thb:liability:credit_card:scb-up",
  cardKrungsriFirst: "thb:liability:credit_card:krungsri-first",

  mortgageCondo: "thb:liability:loan:mortgage-condo",
  mortgageHouse: "thb:liability:loan:mortgage-house",
  personalLoan: "thb:liability:loan:personal-ktb",
  carLoan: "thb:liability:loan:car",

  salary: "thb:income:salary",
  bonus: "thb:income:bonus",
  consulting: "thb:income:consulting",
  interestIncome: "thb:income:interest",
  dividendTHB: "thb:income:dividend",
  realizedGain: "thb:income:investment:realized-gain",

  groceries: "thb:expense:food:groceries",
  restaurants: "thb:expense:food:restaurants",
  coffee: "thb:expense:food:coffee",
  delivery: "thb:expense:food:delivery",
  fineDining: "thb:expense:food:fine-dining",

  btsMrt: "thb:expense:transport:bts-mrt",
  fuel: "thb:expense:transport:fuel",
  grab: "thb:expense:transport:grab",
  tolls: "thb:expense:transport:tolls",
  parking: "thb:expense:transport:parking",

  condoFee: "thb:expense:housing:condo-fee",
  maintenance: "thb:expense:housing:maintenance",
  houseUpkeep: "thb:expense:housing:house-upkeep",

  housekeeper: "thb:expense:household:housekeeper",
  gardening: "thb:expense:household:gardening",
  laundry: "thb:expense:household:laundry",

  mortgageInterest: "thb:expense:interest:mortgage",
  carInterest: "thb:expense:interest:car",
  personalInterest: "thb:expense:interest:personal",
  cardInterest: "thb:expense:interest:credit-card",

  electricity: "thb:expense:utilities:electricity",
  water: "thb:expense:utilities:water",
  internet: "thb:expense:utilities:internet",
  mobile: "thb:expense:utilities:mobile",

  streaming: "thb:expense:subscriptions:streaming",
  software: "thb:expense:subscriptions:software",
  fitness: "thb:expense:subscriptions:fitness",

  shoppingOnline: "thb:expense:shopping:online",
  clothing: "thb:expense:shopping:clothing",
  electronics: "thb:expense:shopping:electronics",
  homeGoods: "thb:expense:shopping:home",
  departmentStore: "thb:expense:shopping:department-store",

  pharmacy: "thb:expense:health:pharmacy",
  clinic: "thb:expense:health:clinic",
  dental: "thb:expense:health:dental",

  healthInsurance: "thb:expense:insurance:health",
  carInsurance: "thb:expense:insurance:car",
  condoInsurance: "thb:expense:insurance:condo",
  lifeInsurance: "thb:expense:insurance:life",

  golf: "thb:expense:leisure:golf",
  entertainment: "thb:expense:leisure:entertainment",

  flights: "thb:expense:travel:flights",
  hotels: "thb:expense:travel:hotels",
  travelDining: "thb:expense:travel:dining",
  travelShopping: "thb:expense:travel:shopping",

  incomeTax: "thb:expense:tax:income-tax",
  socialSecurity: "thb:expense:tax:social-security",
  withholdingTax: "thb:expense:tax:wht",

  allowance: "thb:expense:family:allowance",
  familyMedical: "thb:expense:family:medical",
  familyUtilities: "thb:expense:family:utilities",

  donation: "thb:expense:donation",

  bankFees: "thb:expense:fees:bank",
  fxFees: "thb:expense:fees:fx",
  brokerageFees: "thb:expense:fees:brokerage",

  openingTHB: "thb:equity:opening",
  conversionTHB: "thb:equity:conversion",

  brokerageCash: "usd:asset:brokerage:cash",
  etfVoo: "usd:asset:etf:voo",
  stockAapl: "usd:asset:stock:aapl",
  stockMsft: "usd:asset:stock:msft",
  stockNvda: "usd:asset:stock:nvda",
  stockGoogl: "usd:asset:stock:googl",
  stockAmzn: "usd:asset:stock:amzn",
  stockMeta: "usd:asset:stock:meta",
  stockTsla: "usd:asset:stock:tsla",
  stockAvgo: "usd:asset:stock:avgo",
  stockV: "usd:asset:stock:v",
  stockJpm: "usd:asset:stock:jpm",

  dividendUSD: "usd:income:dividend",
  realizedGainUSD: "usd:income:investment:realized-gain",
  openingUSD: "usd:equity:opening",
  conversionUSD: "usd:equity:conversion",
} as const;

/**
 * A unit ledger is two accounts under a head of its own: what is held, and the
 * contra every acquisition and disposal passes through. Quantity is money's own
 * kind of double entry — the shares have to come from somewhere for the ledger
 * to balance in that head, and they have to go somewhere when they are sold.
 */
export const unitAccountsOf = (
  code: string,
): { position: string; equity: string } => ({
  position: `${code}:asset:position`,
  equity: `${code}:equity:conversion`,
});

/** Ingest silently parks unresolved rows here; the seed must never produce one. */
export const POISON_ACCOUNTS = [
  "thb:expense:uncategorized",
  "thb:equity:adjustments",
] as const;
