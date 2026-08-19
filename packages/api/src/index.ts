import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "./root";

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

export { type AppRouter, appRouter } from "./root";
export { createTRPCContext } from "./trpc";
export type { RouterInputs, RouterOutputs };

export type { ProbeReason } from "./config/probe";
export { readGateway } from "./config/store";
export { oledCauseOf } from "./result";
export { ledger } from "./trpc";
export {
  ACCOUNT_ID_PATTERN,
  FILE_ID_PATTERN,
} from "@openledger-cfo/openledger";
