"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createTRPCClient,
  httpBatchStreamLink,
  loggerLink,
} from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { once } from "es-toolkit";
import SuperJSON from "superjson";

import type { AppRouter } from "@openledger-cfo/api";

import { createQueryClient } from "./query-client";

/**
 * The browser keeps one cache for the whole session; each server render gets
 * its own, so no request ever reads another's data.
 */
const browserQueryClient = once(createQueryClient);
const getQueryClient = () =>
  typeof window === "undefined" ? createQueryClient() : browserQueryClient();

const getBaseUrl = () =>
  typeof window === "undefined"
    ? "http://localhost:3001"
    : window.location.origin;

/** The app's one environment read, which the bundler folds to a literal. */
// eslint-disable-next-line no-restricted-properties
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";

export const { useTRPC, useTRPCClient, TRPCProvider } =
  createTRPCContext<AppRouter>();

export function TRPCReactProvider(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        loggerLink({
          enabled: (op) =>
            IS_DEVELOPMENT ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        httpBatchStreamLink({
          transformer: SuperJSON,
          url: getBaseUrl() + "/api/trpc",
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {props.children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
