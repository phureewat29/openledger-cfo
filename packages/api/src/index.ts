import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "./root";

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export { type AppRouter, appRouter } from "./root";
export { createTRPCContext } from "./trpc";

export type { ProbeReason } from "./config/probe";
export { readGateway } from "./config/store";
export { oledCauseOf } from "./result";
export { ledger } from "./trpc";
