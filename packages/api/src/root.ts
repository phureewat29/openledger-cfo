import { budgetsRouter } from "./router/budgets";
import { goalsRouter } from "./router/goals";
import { insightsRouter } from "./router/insights";
import { ledgerRouter } from "./router/ledger";
import { remindersRouter } from "./router/reminders";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  ledger: ledgerRouter,
  budgets: budgetsRouter,
  goals: goalsRouter,
  insights: insightsRouter,
  reminders: remindersRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
