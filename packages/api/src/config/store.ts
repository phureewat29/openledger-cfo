import { z } from "zod/v4";

import type { Result } from "@openledger-cfo/openledger";
import { db } from "@openledger-cfo/db/client";
import { configuration } from "@openledger-cfo/db/schema";
import { err, ok } from "@openledger-cfo/openledger";

export const DEFAULT_AI_MODEL = "qwen/qwen3.8-27b";

export const HttpUrlSchema = z.url({ protocol: /^https?$/ }).max(400);

// Plain overwrite: the form always sends the key field, "" meaning keyless.
export const SaveGatewaySchema = z.object({
  baseUrl: HttpUrlSchema,
  apiKey: z.string().max(400).default(""),
  model: z.string().min(1).max(120).default(DEFAULT_AI_MODEL),
});

/** The singleton row's fixed primary key. */
const CONFIG_ROW_ID = "app";

/** The agent package declares this shape too; they stay structurally equal. */
export interface GatewayConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

export interface ConfigReadError {
  readonly reason: "missing-table" | "unavailable";
  readonly message: string;
}

type ConfigurationRow = typeof configuration.$inferSelect;

/** A database that predates `pnpm db:push` answers "no such table" — a setup state with its own words. */
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

/**
 * Every caller only asks "is there a gateway", and the root layout and chat
 * route sit on this — a control-plane hiccup must read as "not configured",
 * never become a 500.
 */
export const readGateway = async (): Promise<GatewayConfig | undefined> => {
  const row = await readConfigurationRow();
  if (!row.ok || row.value === undefined) return undefined;
  return {
    baseUrl: row.value.aiBaseUrl,
    apiKey: row.value.aiApiKey,
    model: row.value.aiModel,
  };
};

/** `ocrSharesGateway` omitted leaves the stored flag alone. */
export const saveConfiguration = async (input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  ocrSharesGateway?: boolean;
}): Promise<Result<void, ConfigReadError>> => {
  const row = {
    aiBaseUrl: input.baseUrl,
    aiApiKey: input.apiKey,
    aiModel: input.model,
    ...(input.ocrSharesGateway === undefined
      ? {}
      : { ocrSharesGateway: input.ocrSharesGateway }),
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
