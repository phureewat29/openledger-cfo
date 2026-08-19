"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { RouterInputs, RouterOutputs } from "@openledger-cfo/api";
import { Button } from "@openledger-cfo/ui/button";
import { Input } from "@openledger-cfo/ui/input";

import type { Candidate } from "./candidate";
import type { Line } from "./section-box";
import { Field } from "~/components/plan/field";
import { useTRPC } from "~/trpc/react";
import { httpUrl, invalid, probeLine } from "./candidate";
import { settleFocus } from "./focus";
import { SectionBox } from "./section-box";

const DEFAULTS = {
  gateway: { baseUrl: "https://openrouter.ai/api/v1" },
  ocr: { baseUrl: "https://api.opentyphoon.ai/v1" },
};

const KEY_PLACEHOLDER = "optional — leave blank for keyless endpoints";

type OcrSaveInput = NonNullable<RouterInputs["configuration"]["save"]["ocr"]>;
type Settings = RouterOutputs["configuration"]["get"];

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
  const [shares, setShares] = useState(ocrView?.sharesGateway ?? true);
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

  // A green line may never describe values it did not test.
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

  // The model is checked by both callers before this runs; URL and key only.
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
    input: { baseUrl: string; apiKey: string },
  ) => {
    setLine({ tone: "muted", word: "Testing…" });
    test.mutate(
      {
        baseUrl: input.baseUrl,
        ...(input.apiKey.length > 0 ? { apiKey: input.apiKey } : {}),
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
    probe(gatewayTest, setGatewayLine, gateway.value);

    if (!ocrEnabled || ocrView === undefined) return;
    const target = shares
      ? { ok: true as const, value: gateway.value }
      : ocrCandidate();
    if (!target.ok) return setOcrLine(invalid(target.message));
    probe(ocrTest, setOcrLine, target.value);
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
   * `undefined` leaves the ledger's OCR settings alone: when its view was
   * unreadable no verdict is safe, and when OCR is off on both sides there
   * is nothing to clear — a forward would only invent new failure modes.
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

    // Whatever the fields hold is what gets saved.
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
            // The gateway row was written before the OCR forward failed;
            // the rest of the app must not keep denying it.
            if (result.reason === "ocr-forward-failed") router.refresh();
            return;
          }
          onClose();
          // The save unmounts whichever CTA opened the dialog once refresh
          // lands, so the native focus restore cannot be trusted here.
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
          <h2 className="text-base font-medium">AI Gateway Configuration</h2>
          <p className="text-muted-foreground text-xs">
            Keys stay on this machine.
          </p>
        </div>

        <SectionBox title="Gateway" line={gatewayLine}>
          <p className="text-muted-foreground text-xs">
            Used by chat and the ingest agent.
          </p>
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
