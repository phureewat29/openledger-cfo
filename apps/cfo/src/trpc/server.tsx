import type { TRPCQueryOptions } from "@trpc/tanstack-react-query";
import { cache } from "react";
import { headers } from "next/headers";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

import type { AppRouter } from "@openledger-fleet/api";
import { appRouter, createTRPCContext } from "@openledger-fleet/api";

import { createQueryClient } from "./query-client";

/** Cached per request, so every server-side call shares one context. */
const createContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set("x-trpc-source", "rsc");

  return createTRPCContext({
    headers: heads,
  });
});

const getQueryClient = cache(createQueryClient);

export const trpc = createTRPCOptionsProxy<AppRouter>({
  router: appRouter,
  ctx: createContext,
  queryClient: getQueryClient,
});

/**
 * Direct server-side calls for code that needs the data itself rather than
 * query options — the RSC page computing insights, and the chat route's tools.
 */
export const caller = appRouter.createCaller(createContext);

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
