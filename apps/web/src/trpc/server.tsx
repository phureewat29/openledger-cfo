import type { TRPCQueryOptions } from "@trpc/tanstack-react-query";
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
/**
 * Awaiting the returned promise is what decides whether the pane renders its
 * data in the server pass or a pending shell the stream fills in later.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prefetch<T extends ReturnType<TRPCQueryOptions<any>>>(
  queryOptions: T,
): Promise<void> {
  const queryClient = getQueryClient();
  if (queryOptions.queryKey[1]?.type === "infinite") {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    return queryClient.prefetchInfiniteQuery(queryOptions as any);
  }
  return queryClient.prefetchQuery(queryOptions);
}
