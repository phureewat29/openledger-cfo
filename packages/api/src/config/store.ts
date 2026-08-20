import { z } from "zod/v4";

import type { Result } from "@openledger-cfo/openledger";
import { db } from "@openledger-cfo/db/client";
import { configuration } from "@openledger-cfo/db/schema";
import { err, ok } from "@openledger-cfo/openledger";

export const DEFAULT_AI_MODEL = "qwen/qwen3.8-27b";

export const HttpUrlSchema = z.url({ protocol: /^https?$/ }).max(400);

/** One length rule for every model-id field, so a value cannot test green and then fail to save. */
export const ModelIdSchema = z.string().min(1).max(120);

// Plain overwrite: the form always sends the key field, "" meaning keyless.
export const SaveGatewaySchema = z.object({
  baseUrl: HttpUrlSchema,
  apiKey: z.string().max(400).default(""),
  model: ModelIdSchema.default(DEFAULT_AI_MODEL),
});

const CONFIG_ROW_ID = "app";

/** The agent package declares this shape too; they stay structurally equal. */
export interface GatewayConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly redact: boolean;
}

export interface ConfigReadError {
  readonly reason: "missing-table" | "unavailable";
  readonly message: string;
}

type ConfigurationRow = typeof configuration.$inferSelect;

/** "no such table" = the db predates `pnpm db:push`: a setup state, not an outage. */
const toStoreError = (cause: unknown): ConfigReadError => {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.includes("no such table")
    ? {
        reason: "missing-table",
        message: "The configuration table is missing — run `pnpm db:push`.",
      }
    : { reason: "unavailable", message };
};

export const readConfigurationRow = async (): Promise<
  Result<ConfigurationRow | undefined, ConfigReadError>
> => {
  try {
    return ok(
      await db.query.configuration.findFirst({
        where: (table, { eq }) => eq(table.id, CONFIG_ROW_ID),
      }),
    );
  } catch (cause) {
    return err(toStoreError(cause));
  }
};

/** A control-plane hiccup reads as "not configured", never a 500 — the layout and chat route sit on this. */
export const readGateway = async (): Promise<GatewayConfig | undefined> => {
  const row = await readConfigurationRow();
  if (!row.ok || row.value === undefined) return undefined;
  return {
    baseUrl: row.value.aiBaseUrl,
    apiKey: row.value.aiApiKey,
    model: row.value.aiModel,
    redact: row.value.aiRedact,
  };
};

/** `ocrSharesGateway` omitted leaves the stored flag alone. */
export const saveConfiguration = async (input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  ocrSharesGateway?: boolean;
  redact?: boolean;
}): Promise<Result<void, ConfigReadError>> => {
  const row = {
    aiBaseUrl: input.baseUrl,
    aiApiKey: input.apiKey,
    aiModel: input.model,
    ...(input.ocrSharesGateway === undefined
      ? {}
      : { ocrSharesGateway: input.ocrSharesGateway }),
    ...(input.redact === undefined ? {} : { aiRedact: input.redact }),
  };
  try {
    await db
      .insert(configuration)
      .values({ id: CONFIG_ROW_ID, ...row })
      .onConflictDoUpdate({ target: configuration.id, set: row });
    return ok(undefined);
  } catch (cause) {
    return err(toStoreError(cause));
  }
};
