"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { RouterOutputs } from "@openledger-fleet/api";
import { cn } from "@openledger-fleet/ui";
import { Input, Select } from "@openledger-fleet/ui/input";
import { Pane } from "@openledger-fleet/ui/pane";

import type { BudgetRow } from "~/domain/budgets";
import type { PrefixOption } from "~/server/dashboard";
import { ChartTip } from "~/components/charts/tooltip";
import { Field } from "~/components/plan/field";
import { PlanForm } from "~/components/plan/form";
import { RemoveButton } from "~/components/plan/remove-button";
import { budgetRows } from "~/domain/budgets";
import { formatMultiple, formatThb } from "~/domain/format";
import { useTRPC } from "~/trpc/react";

/** Enough ahead of schedule to be worth a warning rather than noise. */
const OVER_PACE = 1.15;

function Row({
  row,
  elapsed,
  onRemove,
  pending,
}: {
  row: BudgetRow;
  /** The share of the month already gone, which is where the tick sits. */
  elapsed: number;
  onRemove: (category: string) => void;
  pending: boolean;
}) {
  const hot = row.pacing > OVER_PACE;
  // Spending at today's rate for the rest of the month; undefined on day zero.
  const projected = elapsed > 0 ? row.spent / elapsed : undefined;

  return (
    <li className="group relative flex flex-col gap-1 py-1.5">
      <div className="flex items-baseline gap-2 text-[11px]">
        <span className="min-w-0 flex-1 truncate" title={row.label}>
          {row.label}
        </span>
        <span className="shrink-0 tabular-nums">
          {formatThb(row.spent)}
          <span className="text-muted-foreground">
            {" / "}
            {formatThb(row.limit)}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        {/* The tick is where the month itself has got to: a fill short of it is
            ahead of schedule, past it is behind. */}
        <span className="bg-secondary relative h-[3px] min-w-0 flex-1">
          <span
            className={cn("block h-full", hot ? "bg-destructive" : "bg-accent")}
            style={{ width: `${Math.min(row.share, 1) * 100}%` }}
          />
          <span
            aria-hidden
            className="bg-foreground/60 absolute top-1/2 h-[5px] w-px -translate-y-1/2"
            style={{ left: `${Math.min(elapsed, 1) * 100}%` }}
          />
        </span>
        <span
          className={cn(
            "w-10 shrink-0 text-right text-[10px] tabular-nums",
            hot ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {formatMultiple(row.pacing)}
        </span>
        <RemoveButton
          label={`Remove ${row.label} budget`}
          disabled={pending}
          onClick={() => onRemove(row.category)}
        />
      </div>

      {/* Downward only: this list scrolls, so upward overflow is unreachable. */}
      <ChartTip
        className="top-full left-0 opacity-0 group-hover:opacity-100"
        header={row.label}
        rows={[
          { key: "spent", label: "spent", value: formatThb(row.spent) },
          { key: "limit", label: "limit", value: formatThb(row.limit) },
          { key: "pace", label: "pace", value: formatMultiple(row.pacing) },
          ...(projected === undefined
            ? []
            : [
                {
                  key: "projected",
                  label: "month end at this rate",
                  value: formatThb(projected),
                },
              ]),
        ]}
      />
    </li>
  );
}

export function BudgetsPane({
  limits,
  options,
  spend,
  elapsed,
  className,
}: {
  limits: RouterOutputs["budgets"]["list"];
  options: readonly PrefixOption[];
  spend: Readonly<Record<string, number>>;
  elapsed: number;
  className?: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | undefined>(undefined);
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");

  /**
   * Only the limits are re-read after a write. What each category has already
   * cost is a ledger figure that setting or clearing a limit cannot move, so
   * it arrives once with the page and the rows re-derive against it.
   */
  const list = useQuery(
    trpc.budgets.list.queryOptions(undefined, { initialData: limits }),
  );
  const reread = {
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: trpc.budgets.list.queryKey(),
      }),
  };

  const upsert = useMutation(trpc.budgets.upsert.mutationOptions(reread));
  const remove = useMutation(trpc.budgets.remove.mutationOptions(reread));
  const rows = budgetRows(list.data, spend, elapsed);
  // Scoped to the row actually being removed, so removing one budget or
  // submitting the form never dims a sibling row.
  const removingCategory = remove.isPending
    ? remove.variables.category
    : undefined;
  const error = upsert.error ?? remove.error;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAdded(undefined);
    const monthlyLimit = Number(amount);
    if (category.length === 0) return;
    if (!Number.isFinite(monthlyLimit) || monthlyLimit <= 0) return;
    // The column keeps two decimals, and the schema rejects anything finer.
    upsert.mutate(
      { category, monthlyLimit: Math.round(monthlyLimit * 100) / 100 },
      {
        onSuccess: () => {
          const label =
            options.find((option) => option.value === category)?.label ??
            category;
          setAdded(`Set · ${label} ${formatThb(monthlyLimit)}/mo`);
          setAmount("");
        },
      },
    );
  };

  const cancel = () => {
    setAdding(false);
    setAdded(undefined);
    upsert.reset();
  };

  return (
    <Pane
      title="Budgets"
      meta={`${rows.length} set`}
      className={className}
      bodyClassName="flex min-h-0 flex-1 flex-col p-0"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        {rows.length === 0 ? (
          <p className="text-muted-foreground py-2 text-xs">No budgets set.</p>
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((row) => (
              <Row
                key={row.category}
                row={row}
                elapsed={elapsed}
                onRemove={(value) => remove.mutate({ category: value })}
                pending={row.category === removingCategory}
              />
            ))}
          </ul>
        )}
      </div>

      <PlanForm
        label="Set budget"
        open={adding}
        onOpen={() => setAdding(true)}
        onClose={cancel}
        onSubmit={submit}
        onInput={() => setAdded(undefined)}
        submitLabel="Set"
        pending={upsert.isPending}
        error={error}
        added={added}
      >
        <div className="flex items-end gap-2">
          <Field label="Category" className="min-w-0 flex-1">
            <Select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              required
            >
              <option value="" disabled>
                Category…
              </option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Per month" className="w-28 shrink-0">
            <Input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="numeric"
              placeholder="20000"
              className="tabular-nums"
              autoFocus
              required
            />
          </Field>
        </div>
      </PlanForm>
    </Pane>
  );
}
