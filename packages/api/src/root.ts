import { configurationRouter } from "./router/configuration";
import { ledgerRouter } from "./router/ledger";
import {
  budgetsRouter,
  goalsRouter,
  insightsRouter,
  remindersRouter,
} from "./router/plans";
import { createTRPCContext, createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  ledger: ledgerRouter,
  budgets: budgetsRouter,
  configuration: configurationRouter,
  goals: goalsRouter,
  insights: insightsRouter,
  reminders: remindersRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side calls share the one connector, so they queue on its serial ledger lanes and land in its command log. */
export const caller: ReturnType<typeof appRouter.createCaller> =
  appRouter.createCaller(createTRPCContext);
