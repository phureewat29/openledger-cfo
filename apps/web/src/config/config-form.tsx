"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { ProbeReason, RouterOutputs } from "@openledger-cfo/api";
import type { Result } from "@openledger-cfo/openledger/result";
import { err, ok } from "@openledger-cfo/openledger/result";
import { cn } from "@openledger-cfo/ui";
import { Button } from "@openledger-cfo/ui/button";
import { Input } from "@openledger-cfo/ui/input";

import { Field } from "~/lib/ui/field";
import { useTRPC } from "~/trpc/react";
import { settleFocus } from "./focus";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

type Settings = RouterOutputs["configuration"]["get"];

interface Line {
  readonly tone: "muted" | "accent" | "destructive";
  /** The verdict word; long text goes in `detail`. */
  readonly word: string;
  readonly detail?: string;
}

const TONE: Record<Line["tone"], { text: string; border: string }> = {
  muted: { text: "text-muted-foreground", border: "border-border" },
  accent: { text: "text-accent", border: "border-accent" },
  destructive: { text: "text-destructive", border: "border-destructive" },
};

/** The border carries the verdict; the word and detail print inside the box. */
function SectionBox({
  title,
  line,
  children,
}: {
  title: string;
  line: Line | null;
  children: React.ReactNode;
}) {
  return (
    <fieldset
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-md border p-3",
        line === null ? "border-border" : TONE[line.tone].border,
      )}
    >
      <legend className="label px-1">{title}</legend>
      {children}
      {/* Mounted empty, so screen readers hear the first verdict too. */}
      <p role="status" className="text-[11px] break-words empty:sr-only">
        {line === null ? null : (
          <>
            <span className={TONE[line.tone].text}>{line.word}</span>
            {line.detail === undefined ? null : (
              <span className="text-muted-foreground"> — {line.detail}</span>
            )}
          </>
        )}
      </p>
    </fieldset>
  );
}

const ARIA_DISABLED =
  "aria-disabled:pointer-events-none aria-disabled:opacity-50";

const httpUrl = (value: string): boolean => {
  const protocol = URL.parse(value)?.protocol;
  return protocol === "http:" || protocol === "https:";
};

const PROBE_WORDING: Record<ProbeReason, string> = {
  unauthorized: "Authentication failed",
  unreachable: "Connection failed",
  rejected: "Request refused",
};

type Probe = RouterOutputs["configuration"]["test"];

const probeLine = (probe: Probe): Line =>
  probe.ok
    ? { tone: "accent", word: "Connected" }
    : {
        tone: "destructive",
        word: PROBE_WORDING[probe.reason],
        detail: probe.message,
      };

const invalid = (detail: string): Line => ({
  tone: "destructive",
  word: "Invalid",
  detail,
});

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="text-muted-foreground flex h-8 cursor-pointer items-center gap-1.5 text-sm select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-accent size-3.5"
      />
      {label}
    </label>
  );
}

export function ConfigForm({
  initial,
  onClose,
  onSaving,
}: {
  initial: Settings;
  onClose: () => void;
  onSaving: (saving: boolean) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();

  // Fields show what is saved, and what they hold is what gets saved.
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl ?? DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState(initial.apiKey ?? "");
  const [model, setModel] = useState(initial.model);
  const [redact, setRedact] = useState(initial.redact);

  const [gatewayLine, setGatewayLine] = useState<Line | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const gatewayTest = useMutation(trpc.configuration.test.mutationOptions());
  const save = useMutation(
    trpc.configuration.save.mutationOptions({
      onMutate: () => onSaving(true),
      onSettled: () => onSaving(false),
    }),
  );
  const busy = gatewayTest.isPending || save.isPending;

  // A verdict may never describe values it did not test.
  const editGateway =
    (set: (value: string) => void) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      set(event.target.value);
      // Detaches an in-flight probe, so its answer cannot land on new values.
      gatewayTest.reset();
      setGatewayLine(null);
      setFormError(null);
    };
  const editRedact = (next: boolean) => {
    setRedact(next);
    setFormError(null);
  };

  const gatewayCandidate = (): Result<
    { baseUrl: string; apiKey: string; model: string },
    string
  > => {
    const url = baseUrl.trim();
    if (!httpUrl(url)) {
      return err("Base URL must start with http:// or https://.");
    }
    if (model.trim().length === 0) return err("Model is required.");
    return ok({ baseUrl: url, apiKey: apiKey.trim(), model: model.trim() });
  };

  const runTest = () => {
    setFormError(null);
    const gateway = gatewayCandidate();
    if (!gateway.ok) return setGatewayLine(invalid(gateway.error));
    setGatewayLine({ tone: "muted", word: "Testing…" });
    gatewayTest.mutate(gateway.value, {
      onSuccess: (result) => setGatewayLine(probeLine(result)),
      onError: (error) =>
        setGatewayLine({
          tone: "destructive",
          word: "Test failed",
          detail: error.message,
        }),
    });
  };

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.configuration.get.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.configuration.status.queryKey(),
      }),
    ]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setFormError(null);

    const gateway = gatewayCandidate();
    if (!gateway.ok) return setGatewayLine(invalid(gateway.error));

    save.mutate(
      { ...gateway.value, redact },
      {
        onSuccess: (result) => {
          void invalidate();
          if (!result.ok) return setFormError(result.message);
          onClose();
          // Refresh unmounts the CTA that opened this; native restore can't be trusted.
          settleFocus();
          // The root layout does not re-render on soft nav; this flips its props.
          router.refresh();
        },
        onError: (error) => setFormError(error.message),
      },
    );
  };

  const cancel = () => {
    save.reset();
    gatewayTest.reset();
    onClose();
  };

  return (
    <form
      onSubmit={submit}
      className="flex max-h-[calc(100vh-2rem)] min-h-0 flex-col [&_.label]:text-[11px] [&_input]:text-sm"
    >
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">AI Gateway Config</h2>
          <p className="text-muted-foreground text-xs">
            The key is stored on this machine only.
          </p>
        </div>

        <SectionBox title="Gateway" line={gatewayLine}>
          <Field label="Base URL (OpenAI compatible)">
            <Input
              type="url"
              value={baseUrl}
              onChange={editGateway(setBaseUrl)}
              placeholder="https://api.your-gateway.com/v1"
              spellCheck={false}
              autoFocus
              required
            />
          </Field>
          <Field label="API key">
            <Input
              value={apiKey}
              onChange={editGateway(setApiKey)}
              placeholder="optional — leave blank for keyless endpoints"
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
          <Field label="Model">
            <Input
              value={model}
              onChange={editGateway(setModel)}
              placeholder="vendor/model"
              spellCheck={false}
              required
            />
          </Field>
          <div className="flex flex-col gap-0.5">
            <CheckRow
              label="Redact personal details before sending"
              checked={redact}
              onChange={editRedact}
            />
            <p className="text-muted-foreground text-xs">
              Your name and account numbers are masked before they reach the
              gateway.
            </p>
          </div>
        </SectionBox>
      </div>

      <div className="border-border bg-card flex shrink-0 flex-col gap-1.5 border-t px-4 py-3">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            className="px-3 text-sm"
            disabled={save.isPending}
            onClick={cancel}
          >
            Cancel
          </Button>
          {/* aria-disabled, not disabled: a disabled button drops its focus. */}
          <Button
            type="button"
            variant="outline"
            className={cn("min-w-40 text-sm", ARIA_DISABLED)}
            aria-disabled={busy}
            onClick={busy ? undefined : runTest}
          >
            {gatewayTest.isPending ? "Testing…" : "Test connection"}
          </Button>
          <Button
            type="submit"
            className={cn("text-sm", ARIA_DISABLED)}
            aria-disabled={busy}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
        <span role="status" className="sr-only">
          {save.isPending ? "Saving" : ""}
        </span>
        {formError === null ? null : (
          <p role="alert" className="text-destructive text-[11px] break-words">
            {formError}
          </p>
        )}
      </div>
    </form>
  );
}
