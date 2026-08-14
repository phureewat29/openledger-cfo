"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { RouterOutputs } from "@openledger-fleet/api";
import { cn } from "@openledger-fleet/ui";
import { Input, Select } from "@openledger-fleet/ui/input";
import { Pane } from "@openledger-fleet/ui/pane";

import type { GoalProgress, PaceVerdict, PrefixFacts } from "~/domain/goals";
import type { PrefixOption } from "~/server/dashboard";
import { ChartTip } from "~/components/charts/tooltip";
import { Field } from "~/components/plan/field";
import { PlanForm } from "~/components/plan/form";
import { RemoveButton } from "~/components/plan/remove-button";
import { formatPercent, formatThb, formatThbCompact } from "~/domain/format";
import { formatEta, goalProgress, movementVerb } from "~/domain/goals";
import { useTRPC } from "~/trpc/react";

const CHIP = "shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] uppercase";

const VERDICT: Record<PaceVerdict, { label: string; className: string }> = {
  done: { label: "Funded", className: "bg-accent text-accent-foreground" },
  ahead: { label: "Ahead", className: "bg-accent text-accent-foreground" },
  "on-track": {
    label: "On track",
    className: "border-border text-muted-foreground border",
  },
  // Falling behind is the state worth reading, so it is not the quietest one.
  behind: {
    label: "Behind",
    className: "border-border text-foreground border",
  },
  overdue: {
    label: "Overdue",
    className: "border-destructive/40 text-destructive border",
  },
  // No deadline is a fact about the goal, not a judgement on how it is going.
  "no-date": {
    label: "No date",
    className: "border-border text-muted-foreground border",
  },
};

/** One clause per fact, in one order, so two rows read against each other. */
const paceLine = (goal: GoalProgress) => {
  if (goal.verdict === "done") {
    return goal.mode === "paydown"
      ? "Cleared — nothing left to repay."
      : "Funded — point the money elsewhere.";
  }
  const need =
    goal.requiredPerMonth === undefined
      ? []
      : [`needs ${formatThbCompact(goal.requiredPerMonth)}/mo`];
  const eta =
    goal.etaMonths === undefined ? [] : [`≈ ${formatEta(goal.etaMonths)}`];
  return [
    ...need,
    `${movementVerb(goal.mode)} ${formatThbCompact(goal.observedPerMonth)}/mo`,
    ...eta,
  ].join(" · ");
};

/**
 * The pace line has to fit one truncated row; the tip is the same facts with
 * room to keep each figure beside its own name.
 */
const paceRows = (goal: GoalProgress) => [
  {
    key: "current",
    label: "held",
    value: formatThb(goal.current),
    note: formatPercent(goal.progress),
  },
  { key: "target", label: "target", value: formatThb(goal.targetAmount) },
  {
    key: "observed",
    label: `${movementVerb(goal.mode)} per month`,
    value: formatThb(goal.observedPerMonth),
  },
  ...(goal.requiredPerMonth === undefined
    ? []
    : [
        {
          key: "required",
          label: "needs per month",
          value: formatThb(goal.requiredPerMonth),
        },
      ]),
  ...(goal.etaMonths === undefined
    ? []
    : [
        {
          key: "eta",
          label: "at this pace",
          value: formatEta(goal.etaMonths),
        },
      ]),
];

function Row({
  goal,
  onRemove,
  pending,
}: {
  goal: GoalProgress;
  onRemove: (id: string) => void;
  pending: boolean;
}) {
  const verdict = VERDICT[goal.verdict];

  return (
    <li className="group relative flex flex-col gap-1 py-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[11px]" title={goal.name}>
          {goal.name}
        </span>
        <span className={cn(CHIP, verdict.className)}>{verdict.label}</span>
        <RemoveButton
          label={`Remove ${goal.name}`}
          disabled={pending}
          onClick={() => onRemove(goal.id)}
        />
      </div>
      {/* The money column is fixed so every percentage lands on one gridline. */}
      <div className="flex items-center gap-2">
        <span className="bg-secondary h-[3px] min-w-0 flex-1 overflow-hidden">
          <span
            className="bg-accent block h-full"
            style={{ width: `${goal.progress * 100}%` }}
          />
        </span>
        <span className="text-muted-foreground w-10 shrink-0 text-right text-[10px] tabular-nums">
          {formatPercent(goal.progress)}
        </span>
        <span className="w-32 shrink-0 text-right text-[10px] whitespace-nowrap tabular-nums">
          {formatThbCompact(goal.current)}
          <span className="text-muted-foreground">
            {" / "}
            {formatThbCompact(goal.targetAmount)}
          </span>
        </span>
      </div>
      <p className="text-muted-foreground truncate text-xs">{paceLine(goal)}</p>

      {/* Downward only: this list scrolls, so upward overflow is unreachable. */}
      <ChartTip
        className="top-full left-0 opacity-0 group-hover:opacity-100"
        header={goal.name}
        rows={paceRows(goal)}
      />
    </li>
  );
}

export function GoalsPane({
  rows,
  prefixOptions,
  facts,
  today,
  className,
}: {
  rows: RouterOutputs["goals"]["list"];
  prefixOptions: readonly PrefixOption[];
  facts: Readonly<Record<string, PrefixFacts>>;
  today: string;
  className?: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [prefix, setPrefix] = useState(prefixOptions[0]?.value ?? "");

  /**
   * Only the goals themselves are re-read after a write. What each prefix
   * holds and how fast it moves are ledger figures no goal can change, so
   * they arrive once with the page and every row re-derives against them.
   */
  const list = useQuery(
    trpc.goals.list.queryOptions(undefined, { initialData: rows }),
  );
  const reread = {
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: trpc.goals.list.queryKey() }),
  };

  const create = useMutation(trpc.goals.create.mutationOptions(reread));
  const remove = useMutation(trpc.goals.remove.mutationOptions(reread));
  const goals = goalProgress(list.data, facts, today);
  // Scoped to the goal actually being removed, so adding a goal or removing
  // a sibling never dims a row the user did not touch.
  const removingId = remove.isPending ? remove.variables.id : undefined;
  const error = create.error ?? remove.error;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAdded(undefined);
    const targetAmount = Number(amount);
    if (name.length === 0 || prefix.length === 0) return;
    if (!Number.isFinite(targetAmount) || targetAmount <= 0) return;
    create.mutate(
      {
        name,
        targetAmount,
        targetDate: date.length > 0 ? date : undefined,
        accountPrefix: prefix,
      },
      {
        onSuccess: () => {
          setAdded(`Added · ${name}`);
          setName("");
          setAmount("");
          setDate("");
        },
      },
    );
  };

  const cancel = () => {
    setAdding(false);
    setAdded(undefined);
    create.reset();
  };

  return (
    <Pane
      title="Goals"
      meta={`${goals.length} tracked`}
      className={className}
      bodyClassName="flex min-h-0 flex-1 flex-col p-0"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        {goals.length === 0 ? (
          <p className="text-muted-foreground py-2 text-xs">
            No goals. A goal is a target and the account that measures it.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {goals.map((goal) => (
              <Row
                key={goal.id}
                goal={goal}
                onRemove={(id) => remove.mutate({ id })}
                pending={goal.id === removingId}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Collapsed to one quiet row until asked; the list keeps the height. */}
      <PlanForm
        label="Add goal"
        open={adding}
        onOpen={() => setAdding(true)}
        onClose={cancel}
        onSubmit={submit}
        onInput={() => setAdded(undefined)}
        submitLabel="Add"
        pending={create.isPending}
        error={error}
        added={added}
      >
        <div className="flex items-end gap-2">
          <Field label="Goal" className="min-w-0 flex-1">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Emergency runway"
              autoFocus
              required
            />
          </Field>
          <Field label="Measured by" className="min-w-0 flex-1">
            <Select
              value={prefix}
              onChange={(event) => setPrefix(event.target.value)}
            >
              {prefixOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex items-end gap-2">
          <Field label="Target" className="w-28 shrink-0">
            <Input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="numeric"
              placeholder="250000"
              className="tabular-nums"
              required
            />
          </Field>
          <Field label="By" className="max-w-36 min-w-0 flex-1">
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="tabular-nums"
            />
          </Field>
        </div>
      </PlanForm>
    </Pane>
  );
}
