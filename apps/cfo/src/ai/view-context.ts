import { formatDay, moneyOf } from "~/domain/format";
import { loadAccount } from "~/server/account";

/**
 * The client sends only the route; every fact in the block is re-derived here
 * so the model can never be fed figures the server did not compute.
 */
export const accountViewBlock = async (
  id: string,
): Promise<string | undefined> => {
  const view = await loadAccount(id).catch(() => null);
  if (!view) return undefined;

  const inflow = view.monthly.reduce((sum, m) => sum + m.in, 0);
  const outflow = view.monthly.reduce((sum, m) => sum + m.out, 0);
  const money = moneyOf(view.currency);
  // The totals sum `monthly`, so the span quoted must be `monthly`'s own.
  const from = view.monthly[0]
    ? `${view.monthly[0].month}-01`
    : view.window.from;
  return [
    "## Current view",
    `The user is looking at account ${view.id} — ${view.name} (${view.type}).`,
    `Balance ${money(view.balance)} · last activity ${formatDay(view.asOf)}.`,
    `Trailing window ${from} → ${view.asOf}: in ${money(inflow)}, out ${money(outflow)}.`,
    'Answer questions about "this account" against these figures; use tools for anything deeper.',
  ].join("\n");
};
