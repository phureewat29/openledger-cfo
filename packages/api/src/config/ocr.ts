import { z } from "zod/v4";

import type {
  ConfigSetInput,
  OpenLedger,
  Result,
} from "@openledger-cfo/openledger";
import { err, ok } from "@openledger-cfo/openledger";

import type { GatewayConfig } from "./store";
import { HttpUrlSchema, ModelIdSchema } from "./store";

export const DEFAULT_OCR_MODEL = "typhoon-ocr1.5-2b";

const ocrModelSchema = ModelIdSchema.default(DEFAULT_OCR_MODEL);

export const OcrSaveSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("off") }),
  z.object({ mode: z.literal("shared"), model: ocrModelSchema }),
  z.object({
    mode: z.literal("custom"),
    baseUrl: HttpUrlSchema,
    // Plain overwrite: what the field holds is what oled stores, "" clears.
    apiKey: z.string().max(400).default(""),
    model: ocrModelSchema,
  }),
]);
export type OcrSave = z.infer<typeof OcrSaveSchema>;

export type OcrView =
  | { readable: false }
  | {
      readable: true;
      enabled: boolean;
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    };

/**
 * What the ledger holds today. A read failure stays a failure: collapsing it
 * into "OCR off" once let a busy CLI turn a later save into a credential wipe.
 */
export const readOcrView = async (ledger: OpenLedger): Promise<OcrView> => {
  const view = await ledger.config.read();
  if (!view.ok) {
    // The one benign case: no oled config file yet simply means OCR off.
    if (view.error.kind !== "not_configured") return { readable: false };
    return { readable: true, enabled: false };
  }
  const { ocrBaseUrl, ocrModel, ocrApiKey } = view.value;
  return {
    readable: true,
    enabled: ocrBaseUrl !== undefined,
    baseUrl: ocrBaseUrl,
    model: ocrModel,
    // Raw on purpose: a local single-user app shows what it will save.
    apiKey: ocrApiKey,
  };
};

const OCR_FORWARD: {
  [M in OcrSave["mode"]]: (
    ocr: Extract<OcrSave, { mode: M }>,
    gateway: Pick<GatewayConfig, "baseUrl" | "apiKey">,
  ) => ConfigSetInput;
} = {
  off: () => ({ ocrBaseUrl: "", ocrApiKey: "" }),
  shared: (ocr, gateway) => ({
    ocrBaseUrl: gateway.baseUrl,
    ocrModel: ocr.model,
    ocrApiKey: gateway.apiKey,
  }),
  custom: (ocr) => ({
    ocrBaseUrl: ocr.baseUrl,
    ocrModel: ocr.model,
    ocrApiKey: ocr.apiKey,
  }),
};

// The cast only defeats the parameter intersection from union-key indexing;
// each handler stays pinned to its member at the table, so drift is caught there.
const forwardFor = (
  ocr: OcrSave,
  gateway: Pick<GatewayConfig, "baseUrl" | "apiKey">,
): ConfigSetInput => OCR_FORWARD[ocr.mode](ocr as never, gateway);

/** Writes the choice into the oled config; the gateway row is already saved. */
export const forwardOcr = async (
  ledger: OpenLedger,
  ocr: OcrSave,
  gateway: Pick<GatewayConfig, "baseUrl" | "apiKey">,
): Promise<Result<void, string>> => {
  const forwarded = await ledger.config.set(forwardFor(ocr, gateway));
  if (forwarded.ok) return ok(undefined);

  // Nothing to clear on a ledger that is missing or not initialized.
  const nothingThere =
    forwarded.error.kind === "not_configured" ||
    forwarded.error.kind === "spawn_failed";
  if (ocr.mode === "off" && nothingThere) return ok(undefined);
  return err(forwarded.error.message);
};
