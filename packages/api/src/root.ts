import { configurationRouter } from "./router/configuration";
import { ledgerRouter } from "./router/ledger";
import {
  budgetsRouter,
  goalsRouter,
  insightsRouter,
  remindersRouter,
} from "./router/plans";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  ledger: ledgerRouter,
  budgets: budgetsRouter,
  configuration: configurationRouter,
  goals: goalsRouter,
  insights: insightsRouter,
  reminders: remindersRouter,
});

export type AppRouter = typeof appRouter;
