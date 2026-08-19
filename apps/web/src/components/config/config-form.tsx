"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type {
  ProbeReason,
  RouterInputs,
  RouterOutputs,
} from "@openledger-cfo/api";
import { cn } from "@openledger-cfo/ui";
import { Button } from "@openledger-cfo/ui/button";
import { Input } from "@openledger-cfo/ui/input";

import { Field } from "~/components/plan/field";
import { useTRPC } from "~/trpc/react";
import { settleFocus } from "./focus";

const DEFAULTS = {
  gateway: { baseUrl: "https://openrouter.ai/api/v1" },
  ocr: { baseUrl: "http://127.0.0.1:1234" },
};

const KEY_PLACEHOLDER = "optional — leave blank for keyless endpoints";

type OcrSaveInput = NonNullable<RouterInputs["configuration"]["save"]["ocr"]>;
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
      {line === null ? null : (
        <p role="status" className="text-[11px] break-words">
          <span className={TONE[line.tone].text}>{line.word}</span>
          {line.detail === undefined ? null : (
            <span className="text-muted-foreground"> — {line.detail}</span>
          )}
        </p>
      )}
    </fieldset>
  );
}

/** Form-side Result: `message` reads better than `error` at a validation site. */
type Candidate<T> = { ok: true; value: T } | { ok: false; message: string };

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

  // The ledger's OCR view; undefined when it did not answer (section disabled).
  const ocrView = initial.ocr.readable ? initial.ocr : undefined;

  // Fields show what is saved, and what they hold is what gets saved.
  const [baseUrl, setBaseUrl] = useState(
    initial.baseUrl ?? DEFAULTS.gateway.baseUrl,
  );
  const [apiKey, setApiKey] = useState(initial.apiKey ?? "");
  const [model, setModel] = useState(initial.model);
  const [ocrEnabled, setOcrEnabled] = useState(ocrView?.enabled ?? false);
  const [shares, setShares] = useState(ocrView?.sharesGateway ?? false);
  const [ocrBaseUrl, setOcrBaseUrl] = useState(
    ocrView?.baseUrl ?? DEFAULTS.ocr.baseUrl,
  );
  const [ocrApiKey, setOcrApiKey] = useState(ocrView?.apiKey ?? "");
  const [ocrModel, setOcrModel] = useState(ocrView?.model ?? "");

  const [gatewayLine, setGatewayLine] = useState<Line | null>(null);
  const [ocrLine, setOcrLine] = useState<Line | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const gatewayTest = useMutation(trpc.configuration.test.mutationOptions());
  const ocrTest = useMutation(trpc.configuration.test.mutationOptions());
  const save = useMutation(
    trpc.configuration.save.mutationOptions({
      onMutate: () => onSaving(true),
      onSettled: () => onSaving(false),
    }),
  );
  const busy = gatewayTest.isPending || ocrTest.isPending || save.isPending;

  // A verdict may never describe values it did not test.
  const editGateway =
    (set: (value: string) => void) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      set(event.target.value);
      setGatewayLine(null);
      setFormError(null);
      if (shares) setOcrLine(null);
    };
  const editOcr =
    (set: (value: string) => void) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      set(event.target.value);
      setOcrLine(null);
      setFormError(null);
    };
  const editOcrFlag = (set: (next: boolean) => void) => (next: boolean) => {
    set(next);
    setOcrLine(null);
    setFormError(null);
  };

  const gatewayCandidate = (): Candidate<{
    baseUrl: string;
    apiKey: string;
    model: string;
  }> => {
    const url = baseUrl.trim();
    if (!httpUrl(url)) {
      return {
        ok: false,
        message: "Base URL must start with http:// or https://.",
      };
    }
    if (model.trim().length === 0) {
      return { ok: false, message: "Model is required." };
    }
    return {
      ok: true,
      value: { baseUrl: url, apiKey: apiKey.trim(), model: model.trim() },
    };
  };

  // URL and key only; both callers validate the model first.
  const ocrCandidate = (): Candidate<{ baseUrl: string; apiKey: string }> => {
    const url = ocrBaseUrl.trim();
    if (!httpUrl(url)) {
      return {
        ok: false,
        message: "OCR base URL must start with http:// or https://.",
      };
    }
    return { ok: true, value: { baseUrl: url, apiKey: ocrApiKey.trim() } };
  };

  const probe = (
    test: typeof gatewayTest,
    setLine: (line: Line) => void,
    input: {
      baseUrl: string;
      apiKey: string;
      model: string;
      kind: "gateway" | "ocr";
    },
  ) => {
    setLine({ tone: "muted", word: "Testing…" });
    test.mutate(
      {
        baseUrl: input.baseUrl,
        ...(input.apiKey.length > 0 ? { apiKey: input.apiKey } : {}),
        model: input.model,
        kind: input.kind,
      },
      {
        onSuccess: (result) => setLine(probeLine(result)),
        onError: (error) =>
          setLine({
            tone: "destructive",
            word: "Test failed",
            detail: error.message,
          }),
      },
    );
  };

  const runTest = () => {
    setFormError(null);
    const gateway = gatewayCandidate();
    if (!gateway.ok) return setGatewayLine(invalid(gateway.message));
    probe(gatewayTest, setGatewayLine, { ...gateway.value, kind: "gateway" });

    if (!ocrEnabled || ocrView === undefined) return;
    if (ocrModel.trim().length === 0) {
      return setOcrLine(invalid("OCR model is required."));
    }
    const target = shares
      ? { ok: true as const, value: gateway.value }
      : ocrCandidate();
    if (!target.ok) return setOcrLine(invalid(target.message));
    probe(ocrTest, setOcrLine, {
      ...target.value,
      model: ocrModel.trim(),
      kind: "ocr",
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

  /**
   * `undefined` leaves the ledger's OCR settings alone: unreadable view, or
   * off on both sides — a forward would only invent failure modes.
   */
  const ocrSaveInput = (): Candidate<OcrSaveInput | undefined> => {
    if (ocrView === undefined) return { ok: true, value: undefined };
    if (!ocrEnabled) {
      return { ok: true, value: ocrView.enabled ? { mode: "off" } : undefined };
    }
    if (ocrModel.trim().length === 0) {
      return { ok: false, message: "OCR model is required." };
    }
    if (shares) {
      return { ok: true, value: { mode: "shared", model: ocrModel.trim() } };
    }
    const candidate = ocrCandidate();
    if (!candidate.ok) return candidate;
    return {
      ok: true,
      value: { mode: "custom", model: ocrModel.trim(), ...candidate.value },
    };
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const gateway = gatewayCandidate();
    if (!gateway.ok) return setGatewayLine(invalid(gateway.message));
    const ocr = ocrSaveInput();
    if (!ocr.ok) return setOcrLine(invalid(ocr.message));

    save.mutate(
      {
        ...gateway.value,
        ...(ocr.value === undefined ? {} : { ocr: ocr.value }),
      },
      {
        onSuccess: (result) => {
          void invalidate();
          if (!result.ok) {
            setFormError(result.message);
            // The gateway row is already written; the app must not keep denying it.
            if (result.reason === "ocr-forward-failed") router.refresh();
            return;
          }
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
    ocrTest.reset();
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
            Keys stay on this machine.
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
              placeholder={KEY_PLACEHOLDER}
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
        </SectionBox>

        <SectionBox title="OCR" line={ocrView === undefined ? null : ocrLine}>
          {ocrView === undefined ? (
            <p className="text-muted-foreground text-xs">
              The ledger did not answer, so OCR settings cannot be read right
              now. Saving leaves them untouched.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-0.5">
                <CheckRow
                  label="Enable OCR"
                  checked={ocrEnabled}
                  onChange={editOcrFlag(setOcrEnabled)}
                />
                <p className="text-muted-foreground text-xs">
                  Reads scanned statements during ingest. Any OpenAI-compatible
                  vision endpoint works.
                </p>
              </div>

              {ocrEnabled ? (
                <div className="flex flex-col gap-2">
                  <CheckRow
                    label="Use the gateway endpoint and key"
                    checked={shares}
                    onChange={editOcrFlag(setShares)}
                  />
                  {shares ? null : (
                    <>
                      <Field label="OCR base URL">
                        <Input
                          type="url"
                          value={ocrBaseUrl}
                          onChange={editOcr(setOcrBaseUrl)}
                          placeholder="https://api.your-ocr.com/v1"
                          spellCheck={false}
                          required
                        />
                      </Field>
                      <Field label="OCR API key">
                        <Input
                          value={ocrApiKey}
                          onChange={editOcr(setOcrApiKey)}
                          placeholder={KEY_PLACEHOLDER}
                          spellCheck={false}
                          autoComplete="off"
                        />
                      </Field>
                    </>
                  )}
                  <Field label="OCR model">
                    <Input
                      value={ocrModel}
                      onChange={editOcr(setOcrModel)}
                      spellCheck={false}
                      required
                    />
                  </Field>
                </div>
              ) : null}
            </>
          )}
        </SectionBox>
      </div>

      <div className="border-border bg-card flex shrink-0 flex-col gap-1.5 border-t px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            className="text-sm"
            disabled={save.isPending}
            onClick={cancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            className="text-sm"
            disabled={busy}
            onClick={runTest}
          >
            {gatewayTest.isPending || ocrTest.isPending
              ? "Testing…"
              : "Test connection"}
          </Button>
          <Button type="submit" className="text-sm" disabled={busy}>
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
