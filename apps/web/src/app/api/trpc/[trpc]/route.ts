import type { NextRequest } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter, createTRPCContext } from "@openledger-cfo/api";

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: createTRPCContext,
    onError({ error, path }) {
      console.error(`tRPC error on '${path}'`, error);
    },
  });

export { handler as GET, handler as POST };
