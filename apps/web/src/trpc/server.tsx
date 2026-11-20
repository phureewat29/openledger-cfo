import type { QueryClient } from "@tanstack/react-query";
import { cache } from "react";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

import type { AppRouter } from "@openledger-cfo/api";
import { appRouter, createTRPCContext } from "@openledger-cfo/api";

import { createQueryClient } from "./query-client";

/** One per request, so no render dehydrates another's data. */
const getQueryClient = cache(createQueryClient);

export const trpc = createTRPCOptionsProxy<AppRouter>({
  router: appRouter,
  ctx: createTRPCContext,
  queryClient: getQueryClient,
});

export function HydrateClient(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {props.children}
    </HydrationBoundary>
  );
}

/** Awaited, the pane renders its data in the server pass; not awaited, the stream fills it in later. */
export const prefetch: QueryClient["prefetchQuery"] = (options) =>
  getQueryClient().prefetchQuery(options);
