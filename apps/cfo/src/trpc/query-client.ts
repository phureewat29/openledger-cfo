import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from "@tanstack/react-query";
import SuperJSON from "superjson";

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // Non-zero, so a hydrated query does not refetch the moment it mounts.
        staleTime: 30 * 1000,
      },
      dehydrate: {
        serializeData: SuperJSON.serialize,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
        // Next detects dynamic pages by its own server errors, so redacting
        // them here would swallow that signal; Next redacts them itself.
        shouldRedactErrors: () => false,
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  });
