import { z } from "zod/v4";

import { unwrapOr } from "@openledger-cfo/openledger";

import { probeChat, probeModels } from "../config/probe";
import {
  DEFAULT_AI_MODEL,
  readConfigurationRow,
  readGateway,
  saveConfiguration,
  SaveGatewaySchema,
} from "../config/store";
import { createTRPCRouter, publicProcedure } from "../trpc";

export const configurationRouter = createTRPCRouter({
  get: publicProcedure.query(async () => {
    const row = await readConfigurationRow();
    const saved = unwrapOr(row, undefined);
    return {
      store: row.ok ? ("ready" as const) : row.error.reason,
      configured: saved !== undefined,
      baseUrl: saved?.aiBaseUrl,
      // Raw on purpose: a local single-user app shows what it will save.
      apiKey: saved?.aiApiKey,
      model: saved?.aiModel ?? DEFAULT_AI_MODEL,
      redact: saved?.aiRedact ?? true,
    };
  }),

  save: publicProcedure
    .input(SaveGatewaySchema.extend({ redact: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      const saved = await saveConfiguration(input);
      if (!saved.ok) {
        return {
          ok: false as const,
          reason: saved.error.reason,
          message: saved.error.message,
        };
      }
      return { ok: true as const };
    }),

  test: publicProcedure
    .input(SaveGatewaySchema)
    .mutation(({ input }) => probeChat(input)),

  status: publicProcedure.query(async () => {
    const gateway = await readGateway();
    if (gateway === undefined) return { configured: false as const };
    // The model rides for the chip's live text after a save.
    return {
      configured: true as const,
      model: gateway.model,
      ...(await probeModels({
        baseUrl: gateway.baseUrl,
        apiKey: gateway.apiKey,
      })),
    };
  }),
});
