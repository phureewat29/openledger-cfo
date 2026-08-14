import type { MerchantUpsertInput } from "@openledger-fleet/openledger";

import { ACCOUNT } from "./accounts";

export interface Merchant {
  canonical: string;
  /** Thai statements arrive as terminal descriptors, not brand names. */
  alias: string;
  account: string;
}

const define = <T extends Record<string, Merchant>>(table: T): T => table;

export const MERCHANT = define({
  sevenEleven: {
    canonical: "7-Eleven",
    alias: "7-ELEVEN 13324 ARI BANGKOK TH",
    account: ACCOUNT.restaurants,
  },
  familyMart: {
    canonical: "FamilyMart",
    alias: "FAMILYMART 22190 THONGLOR BANGKOK TH",
    account: ACCOUNT.restaurants,
  },
  cafeAmazon: {
    canonical: "Cafe Amazon",
    alias: "CAFE AMAZON PTT VIPHAVADI BANGKOK TH",
    account: ACCOUNT.coffee,
  },
  starbucks: {
    canonical: "Starbucks",
    alias: "STARBUCKS COFFEE SIAM PARAGON TH",
    account: ACCOUNT.coffee,
  },
  roots: {
    canonical: "Roots Coffee",
    alias: "SQ *ROOTS COFFEE THONGLOR TH",
    account: ACCOUNT.coffee,
  },
  blueBottle: {
    canonical: "Blue Bottle Coffee",
    alias: "BLUE BOTTLE COFFEE EKKAMAI BANGKOK TH",
    account: ACCOUNT.coffee,
  },
  somTamNua: {
    canonical: "Som Tam Nua",
    alias: "LPTH*SOMTAM NUA THONGLOR TH",
    account: ACCOUNT.restaurants,
  },
  mkRestaurants: {
    canonical: "MK Restaurants",
    alias: "MK RESTAURANT CENTRAL LADPRAO TH",
    account: ACCOUNT.restaurants,
  },
  foodCourt: {
    canonical: "Food Patio",
    alias: "FOOD PATIO CENTRALWORLD BANGKOK TH",
    account: ACCOUNT.restaurants,
  },
  afterYou: {
    canonical: "After You",
    alias: "AFTER YOU DESSERT CAFE EMQUARTIER TH",
    account: ACCOUNT.restaurants,
  },
  sushiro: {
    canonical: "Sushiro",
    alias: "SUSHIRO CENTRAL RAMA 9 BANGKOK TH",
    account: ACCOUNT.restaurants,
  },
  peppina: {
    canonical: "Peppina",
    alias: "PEPPINA ARI SOI 4 BANGKOK TH",
    account: ACCOUNT.restaurants,
  },
  bonchon: {
    canonical: "Bonchon",
    alias: "BONCHON CHICKEN ASOKE BANGKOK TH",
    account: ACCOUNT.restaurants,
  },
  grabFood: {
    canonical: "GrabFood",
    alias: "GRABFOOD* KRUA BANGKOK TH",
    account: ACCOUNT.delivery,
  },
  lineman: {
    canonical: "LINE MAN",
    alias: "LINEMAN WONGNAI* ORDER BANGKOK TH",
    account: ACCOUNT.delivery,
  },
  sorn: {
    canonical: "Sorn",
    alias: "SORN RESTAURANT PHROM PHONG TH",
    account: ACCOUNT.fineDining,
  },
  gaggan: {
    canonical: "Gaggan Anand",
    alias: "GAGGAN ANAND LUMPINI BANGKOK TH",
    account: ACCOUNT.fineDining,
  },
  leDu: {
    canonical: "Le Du",
    alias: "LE DU RESTAURANT SILOM BANGKOK TH",
    account: ACCOUNT.fineDining,
  },
  sushiMasato: {
    canonical: "Sushi Masato",
    alias: "SUSHI MASATO THONGLOR BANGKOK TH",
    account: ACCOUNT.fineDining,
  },
  tops: {
    canonical: "Tops",
    alias: "TOPS DAILY ARI BANGKOK TH",
    account: ACCOUNT.groceries,
  },
  bigC: {
    canonical: "Big C",
    alias: "BIGC SUPERCENTER RATCHADAMRI TH",
    account: ACCOUNT.groceries,
  },
  villaMarket: {
    canonical: "Villa Market",
    alias: "VILLA MARKET ARI BANGKOK TH",
    account: ACCOUNT.groceries,
  },
  makro: {
    canonical: "Makro",
    alias: "SIAM MAKRO LADPRAO BANGKOK TH",
    account: ACCOUNT.groceries,
  },
  gourmetMarket: {
    canonical: "Gourmet Market",
    alias: "GOURMET MARKET EMQUARTIER BANGKOK TH",
    account: ACCOUNT.groceries,
  },
  bts: {
    canonical: "BTS SkyTrain",
    alias: "BTS RABBIT TOPUP ARI STATION TH",
    account: ACCOUNT.btsMrt,
  },
  grab: {
    canonical: "Grab",
    alias: "GRAB* RIDE BANGKOK TH",
    account: ACCOUNT.grab,
  },
  ptt: {
    canonical: "PTT Station",
    alias: "PTT STATION 09832 VIPHAVADI TH",
    account: ACCOUNT.fuel,
  },
  shell: {
    canonical: "Shell",
    alias: "SHELL STATION 4471 RAMA 9 TH",
    account: ACCOUNT.fuel,
  },
  exat: {
    canonical: "Expressway Authority",
    alias: "EXAT TOLL PLAZA DIN DAENG TH",
    account: ACCOUNT.tolls,
  },
  centralParking: {
    canonical: "Central Parking",
    alias: "CENTRAL PARKING CHIDLOM BANGKOK TH",
    account: ACCOUNT.parking,
  },
  shopee: {
    canonical: "Shopee",
    alias: "SHOPEE*ORDER BANGKOK TH",
    account: ACCOUNT.shoppingOnline,
  },
  lazada: {
    canonical: "Lazada",
    alias: "LAZADA*TH ORDER BANGKOK TH",
    account: ACCOUNT.shoppingOnline,
  },
  uniqlo: {
    canonical: "Uniqlo",
    alias: "UNIQLO CENTRALWORLD BANGKOK TH",
    account: ACCOUNT.clothing,
  },
  zara: {
    canonical: "Zara",
    alias: "ZARA SIAM PARAGON BANGKOK TH",
    account: ACCOUNT.clothing,
  },
  appleStore: {
    canonical: "Apple Store",
    alias: "APPLE STORE ICONSIAM BANGKOK TH",
    account: ACCOUNT.electronics,
  },
  powerBuy: {
    canonical: "Power Buy",
    alias: "POWER BUY CENTRALWORLD BANGKOK TH",
    account: ACCOUNT.electronics,
  },
  homePro: {
    canonical: "HomePro",
    alias: "HOMEPRO RATCHADA BANGKOK TH",
    account: ACCOUNT.homeGoods,
  },
  ikea: {
    canonical: "IKEA",
    alias: "IKEA BANGNA BANGKOK TH",
    account: ACCOUNT.homeGoods,
  },
  centralChidlom: {
    canonical: "Central Chidlom",
    alias: "CENTRAL DEPT STORE CHIDLOM BANGKOK TH",
    account: ACCOUNT.departmentStore,
  },
  siamParagon: {
    canonical: "Siam Paragon",
    alias: "SIAM PARAGON DEPT STORE BANGKOK TH",
    account: ACCOUNT.departmentStore,
  },
  emquartier: {
    canonical: "EmQuartier",
    alias: "THE EMQUARTIER SUKHUMVIT BANGKOK TH",
    account: ACCOUNT.departmentStore,
  },
  watsons: {
    canonical: "Watsons",
    alias: "WATSONS ARI BANGKOK TH",
    account: ACCOUNT.pharmacy,
  },
  boots: {
    canonical: "Boots",
    alias: "BOOTS RETAIL CENTRAL RAMA 9 TH",
    account: ACCOUNT.pharmacy,
  },
  bumrungrad: {
    canonical: "Bumrungrad Hospital",
    alias: "BUMRUNGRAD HOSPITAL BANGKOK TH",
    account: ACCOUNT.clinic,
  },
  samitivej: {
    canonical: "Samitivej Hospital",
    alias: "SAMITIVEJ HOSPITAL SUKHUMVIT TH",
    account: ACCOUNT.clinic,
  },
  bangkokSmile: {
    canonical: "Bangkok Smile Dental",
    alias: "BANGKOK SMILE DENTAL ASOKE TH",
    account: ACCOUNT.dental,
  },
  mea: {
    canonical: "MEA",
    alias: "KPLUS BILLPAY* MEA ELECTRICITY",
    account: ACCOUNT.electricity,
  },
  mwa: {
    canonical: "MWA",
    alias: "KPLUS BILLPAY* MWA WATER",
    account: ACCOUNT.water,
  },
  aisFibre: {
    canonical: "AIS Fibre",
    alias: "KPLUS BILLPAY* AIS FIBRE",
    account: ACCOUNT.internet,
  },
  aisMobile: {
    canonical: "AIS",
    alias: "KPLUS BILLPAY* AIS POSTPAID",
    account: ACCOUNT.mobile,
  },
  netflix: {
    canonical: "Netflix",
    alias: "NETFLIX.COM AMSTERDAM NL",
    account: ACCOUNT.streaming,
  },
  spotify: {
    canonical: "Spotify",
    alias: "SPOTIFY AB STOCKHOLM SE",
    account: ACCOUNT.streaming,
  },
  youtube: {
    canonical: "YouTube Premium",
    alias: "GOOGLE*YOUTUBEPREMIUM G.CO/HELPPAY",
    account: ACCOUNT.streaming,
  },
  disneyPlus: {
    canonical: "Disney+ Hotstar",
    alias: "DISNEY PLUS HOTSTAR SINGAPORE SG",
    account: ACCOUNT.streaming,
  },
  icloud: {
    canonical: "Apple iCloud",
    alias: "APPLE.COM/BILL ITUNES ICLOUD",
    account: ACCOUNT.software,
  },
  adobe: {
    canonical: "Adobe",
    alias: "ADOBE*CREATIVE CLOUD DUBLIN IE",
    account: ACCOUNT.software,
  },
  anthropic: {
    canonical: "Anthropic",
    alias: "ANTHROPIC CLAUDE.AI SAN FRANCISCO US EXCHANGE RATE 36.75",
    account: ACCOUNT.software,
  },
  github: {
    canonical: "GitHub",
    alias: "GITHUB.COM 4.00 USD HTTPSGITHUB.C US",
    account: ACCOUNT.software,
  },
  notion: {
    canonical: "Notion",
    alias: "NOTION LABS INC SAN FRANCISCO US",
    account: ACCOUNT.software,
  },
  fitnessFirst: {
    canonical: "Fitness First",
    alias: "FITNESS FIRST CENTRAL RAMA 9 TH",
    account: ACCOUNT.fitness,
  },
  virginActive: {
    canonical: "Virgin Active",
    alias: "VIRGIN ACTIVE SATHORN BANGKOK TH",
    account: ACCOUNT.fitness,
  },
  aia: {
    canonical: "AIA Thailand",
    alias: "KPLUS BILLPAY* AIA PREMIUM",
    account: ACCOUNT.healthInsurance,
  },
  dhipaya: {
    canonical: "Dhipaya Insurance",
    alias: "KPLUS BILLPAY* DHIPAYA MOTOR",
    account: ACCOUNT.carInsurance,
  },
  viriyah: {
    canonical: "Viriyah Insurance",
    alias: "KPLUS BILLPAY* VIRIYAH MOTOR",
    account: ACCOUNT.carInsurance,
  },
  muangThaiLife: {
    canonical: "Muang Thai Life",
    alias: "KPLUS BILLPAY* MTL LIFE PREMIUM",
    account: ACCOUNT.lifeInsurance,
  },
  sriAyudhyaGeneral: {
    canonical: "Sri Ayudhya General",
    alias: "KPLUS BILLPAY* SRI AYUDHYA GEN",
    account: ACCOUNT.condoInsurance,
  },
  thaiAirways: {
    canonical: "Thai Airways",
    alias: "THAI AIRWAYS TG BKK-NRT TH",
    account: ACCOUNT.flights,
  },
  singaporeAirlines: {
    canonical: "Singapore Airlines",
    alias: "SINGAPORE AIRLINES SIN-BKK SG",
    account: ACCOUNT.flights,
  },
  airAsia: {
    canonical: "AirAsia",
    alias: "AIRASIA FD DOMESTIC BANGKOK TH",
    account: ACCOUNT.flights,
  },
  agoda: {
    canonical: "Agoda",
    alias: "AGODA.COM SINGAPORE SG",
    account: ACCOUNT.hotels,
  },
  marriott: {
    canonical: "Marriott",
    alias: "MARRIOTT MARQUIS QUEENS PARK BANGKOK TH",
    account: ACCOUNT.hotels,
  },
  alpineGolf: {
    canonical: "Alpine Golf Club",
    alias: "ALPINE GOLF CLUB BANGKOK TH",
    account: ACCOUNT.golf,
  },
  majorCineplex: {
    canonical: "Major Cineplex",
    alias: "MAJOR CINEPLEX CENTRALWORLD BANGKOK TH",
    account: ACCOUNT.entertainment,
  },
  donKiHote: {
    canonical: "Don Quijote",
    alias: "DON QUIJOTE SHINJUKU TOKYO JP",
    account: ACCOUNT.travelShopping,
  },
  ichiran: {
    canonical: "Ichiran Ramen",
    alias: "ICHIRAN RAMEN SHIBUYA TOKYO JP",
    account: ACCOUNT.travelDining,
  },
  baanDee: {
    canonical: "BaanDee Home Service",
    alias: "BAANDEE HOME SERVICE BANGKOK TH",
    account: ACCOUNT.housekeeper,
  },
  poolCare: {
    canonical: "PoolCare Bangkok",
    alias: "POOLCARE BANGKOK MONTHLY SERVICE TH",
    account: ACCOUNT.gardening,
  },
  laundryBar: {
    canonical: "The Laundry Bar",
    alias: "THE LAUNDRY BAR THONGLOR BANGKOK TH",
    account: ACCOUNT.laundry,
  },
  bitkub: {
    canonical: "Bitkub",
    alias: "BITKUB ONLINE CO LTD BANGKOK TH",
    account: ACCOUNT.cryptoBtc,
  },
  ibkr: {
    canonical: "Interactive Brokers",
    alias: "INTERACTIVE BROKERS LLC GREENWICH US",
    account: ACCOUNT.brokerageFees,
  },
});

const MERCHANTS: Merchant[] = Object.values(MERCHANT);

export const MERCHANT_UPSERTS: MerchantUpsertInput[] = MERCHANTS.map(
  (merchant) => ({
    name: merchant.canonical,
    alias: merchant.alias,
    default_account: merchant.account,
  }),
);
