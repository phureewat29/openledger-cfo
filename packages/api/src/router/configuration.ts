import { z } from "zod/v4";

import {
  DEFAULT_OCR_MODEL,
  forwardOcr,
  OcrSaveSchema,
  readOcrView,
} from "../config/ocr";
import { probeModels } from "../config/probe";
import {
  DEFAULT_AI_MODEL,
  HttpUrlSchema,
  readConfigurationRow,
  readGateway,
  saveConfiguration,
  SaveGatewaySchema,
} from "../config/store";
import { createTRPCRouter, publicProcedure } from "../trpc";

export const configurationRouter = createTRPCRouter({
  get: publicProcedure.query(async ({ ctx }) => {
    const row = await readConfigurationRow();
    const saved = row.ok ? row.value : undefined;
    const ocr = await readOcrView(ctx.ledger);
    return {
      store: row.ok ? ("ready" as const) : row.error.reason,
      configured: saved !== undefined,
      baseUrl: saved?.aiBaseUrl,
      // Raw on purpose: a local single-user app shows what it will save.
      apiKey: saved?.aiApiKey,
      model: saved?.aiModel ?? DEFAULT_AI_MODEL,
      ocr: ocr.readable
        ? {
            ...ocr,
            model: ocr.model ?? DEFAULT_OCR_MODEL,
            // Shared only reads as a sensible default over an OCR that does not exist yet.
            sharesGateway: saved?.ocrSharesGateway ?? !ocr.enabled,
          }
        : ocr,
    };
  }),

  save: publicProcedure
    // `ocr` absent leaves the ledger's OCR settings untouched entirely.
    .input(SaveGatewaySchema.extend({ ocr: OcrSaveSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      const gateway = {
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: input.model,
      };
      // An absent `ocr` must not speak to the shared flag either.
      const saved = await saveConfiguration({
        ...gateway,
        ...(input.ocr === undefined
          ? {}
          : { ocrSharesGateway: input.ocr.mode === "shared" }),
      });
      if (!saved.ok) {
        return {
          ok: false as const,
          reason: saved.error.reason,
          message: saved.error.message,
        };
      }
      if (input.ocr === undefined) return { ok: true as const };

      const forwarded = await forwardOcr(ctx.ledger, input.ocr, gateway);
      if (!forwarded.ok) {
        return {
          ok: false as const,
          reason: "ocr-forward-failed" as const,
          message: `Gateway saved. OCR settings were not forwarded: ${forwarded.error}`,
        };
      }
      return { ok: true as const };
    }),

  // One `GET /models` answers the Test button and the status dot alike.
  test: publicProcedure
    .input(
      z.object({
        baseUrl: HttpUrlSchema,
        apiKey: z.string().min(1).max(400).optional(),
      }),
    )
    .mutation(({ input }) => probeModels(input)),

  status: publicProcedure.query(async () => {
    const gateway = await readGateway();
    if (gateway === undefined) return { configured: false as const };
    // The model rides along: it is the chip's live text after a save, when
    // the layout's server prop can lag the open tab.
    return {
      configured: true as const,
      model: gateway.model,
      ...(await probeModels(gateway)),
    };
  }),
});
