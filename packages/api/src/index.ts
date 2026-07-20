import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "./root";

type RouterOutputs = inferRouterOutputs<AppRouter>;

export { type AppRouter, appRouter } from "./root";
export { createTRPCContext } from "./trpc";
export type { RouterOutputs };

export { ledger } from "./trpc";
export {
  ACCOUNT_ID_PATTERN,
  FILE_ID_PATTERN,
} from "@openledger-fleet/openledger";
