"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { RouterOutputs } from "@openledger-fleet/api";
import { cn } from "@openledger-fleet/ui";
import { Button } from "@openledger-fleet/ui/button";
import { Input } from "@openledger-fleet/ui/input";
import { Pane } from "@openledger-fleet/ui/pane";

import type { UpcomingItem } from "~/domain/upcoming";
import { AddDisclosure } from "~/components/plan/add-disclosure";
import { Field } from "~/components/plan/field";
import { formatDayMonth, formatThb } from "~/domain/format";
import { mergeUpcoming, SOURCE_LABEL } from "~/domain/upcoming";
import { useTRPC } from "~/trpc/react";

function Row({
  item,
  onComplete,
  onRemove,
  pending,
}: {
  item: UpcomingItem;
  onComplete: (id: string) => void;
  onRemove: (id: string) => void;
  pending: boolean;
}) {
  const overdue = item.overdue === true;
  const reminderId = item.reminderId;

  return (
    <li className="group flex flex-col gap-0.5 py-1.5">
      <div className="flex items-baseline gap-2 text-[11px]">
        <span
          className={cn(
            "w-11 shrink-0 tabular-nums",
            overdue ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {formatDayMonth(item.date)}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            overdue && "text-destructive",
          )}
          title={item.title}
        >
          {item.title}
        </span>
        {reminderId === undefined ? null : (
          <span className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              aria-label={`Complete ${item.title}`}
              disabled={pending}
              onClick={() => onComplete(reminderId)}
            >
              ✓
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              aria-label={`Remove ${item.title}`}
              disabled={pending}
              onClick={() => onRemove(reminderId)}
            >
              ×
            </Button>
          </span>
        )}
      </div>
      <p className="text-muted-foreground pl-[3.25rem] text-[10px] tabular-nums">
        {item.amount === undefined ? "—" : formatThb(item.amount)} ·{" "}
        {SOURCE_LABEL[item.source]}
      </p>
    </li>
  );
}

export function RemindersPane({
  ledger,
  rows,
  today,
  className,
}: {
  ledger: readonly UpcomingItem[];
  rows: RouterOutputs["reminders"]["list"];
  today: string;
  className?: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [monthly, setMonthly] = useState(false);
  const [added, setAdded] = useState<string | undefined>(undefined);

  /**
   * Only the reminders are re-read after a write. Statement days, installments
   * and subscriptions are read off postings, so nothing this form does can
   * move them — they arrive once and the list re-merges around them.
   */
  const list = useQuery(
    trpc.reminders.list.queryOptions(undefined, { initialData: rows }),
  );
  const reread = {
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: trpc.reminders.list.queryKey(),
      }),
  };

  const create = useMutation(trpc.reminders.create.mutationOptions(reread));
  const complete = useMutation(trpc.reminders.complete.mutationOptions(reread));
  const remove = useMutation(trpc.reminders.remove.mutationOptions(reread));
  const items = mergeUpcoming(ledger, list.data, today);
  // Scoped to the row whose reminder is actually in flight, so completing or
  // removing one reminder never dims its siblings.
  const busyId =
    (complete.isPending ? complete.variables.id : undefined) ??
    (remove.isPending ? remove.variables.id : undefined);
  const error = create.error ?? complete.error ?? remove.error;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAdded(undefined);
    if (title.length === 0 || dueDate.length === 0) return;
    create.mutate(
      { title, dueDate, monthly },
      {
        onSuccess: () => {
          // A reminder dated past the horizon is saved but never listed, so
          // this line is the only proof the row exists.
          setAdded(`Added · due ${formatDayMonth(dueDate)}`);
          setTitle("");
          setDueDate("");
          setMonthly(false);
        },
      },
    );
  };

  const act = (run: () => void) => {
    setAdded(undefined);
    run();
  };

  const cancel = () => {
    setAdding(false);
    setAdded(undefined);
    create.reset();
  };

  return (
    <Pane
      title="Reminders"
      meta={`${items.length} items`}
      className={className}
      bodyClassName="flex min-h-0 flex-1 flex-col p-0"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        {items.length === 0 ? (
          <p className="text-muted-foreground py-2 text-xs">
            Nothing scheduled.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {items.map((item) => (
              <Row
                key={item.key}
                item={item}
                onComplete={(id) => act(() => complete.mutate({ id }))}
                onRemove={(id) => act(() => remove.mutate({ id }))}
                pending={
                  item.reminderId !== undefined && item.reminderId === busyId
                }
              />
            ))}
          </ul>
        )}
      </div>

      {/* A saved reminder past the horizon never lists, so the added note is
          its only proof — the form stays open to show it. */}
      <AddDisclosure
        label="Add reminder"
        open={adding}
        onOpen={() => setAdding(true)}
        onClose={cancel}
      >
        <form
          onSubmit={submit}
          onInput={() => setAdded(undefined)}
          aria-label="Add reminder"
          className="border-border shrink-0 border-t px-3 py-2"
        >
          <div className="flex max-w-md flex-col gap-2">
            <Field label="Remind me to">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Pay condo fee"
                autoFocus
                required
              />
            </Field>

            <div className="flex items-end gap-2">
              <Field label="Due" className="max-w-36 min-w-0 flex-1">
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="tabular-nums"
                  required
                />
              </Field>
              <label className="text-muted-foreground flex h-8 shrink-0 cursor-pointer items-center gap-1.5 text-xs select-none">
                <input
                  type="checkbox"
                  checked={monthly}
                  onChange={(event) => setMonthly(event.target.checked)}
                  className="accent-accent size-3.5"
                />
                Monthly
              </label>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={cancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                Add
              </Button>
            </div>

            {error ? (
              <p className="text-destructive text-[10px]">{error.message}</p>
            ) : added === undefined ? null : (
              <p className="text-accent text-[10px]">{added}</p>
            )}
          </div>
        </form>
      </AddDisclosure>
    </Pane>
  );
}
