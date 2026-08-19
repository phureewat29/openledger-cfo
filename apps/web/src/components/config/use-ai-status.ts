"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

/**
 * The saved gateway, probed. No polling interval on purpose: every probe is a
 * real request to the gateway, and the dot answers "is the saved config
 * right", not "is the internet up this second" — focus refetch and the
 * post-save invalidation keep it honest when it matters.
 */
export function useAiStatus(configured: boolean) {
  const trpc = useTRPC();
  return useQuery(
    trpc.configuration.status.queryOptions(undefined, {
      enabled: configured,
      staleTime: 60_000,
    }),
  );
}

export type GatewayVerdict = "pending" | "unknown" | "up" | "down";

/** One answer to "is the gateway up", shared by the chip and the status bar. */
export const verdictOf = (
  status: ReturnType<typeof useAiStatus>,
): GatewayVerdict => {
  if (status.isPending) return "pending";
  if (status.isError) return "unknown";
  return status.data.configured && status.data.ok ? "up" : "down";
};
