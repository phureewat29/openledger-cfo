import type { Metadata } from "next";

import { isAiEnabled } from "@openledger-fleet/agent";

import { SetupCard } from "~/app/_components/setup-card";
import { INGEST_GRID, INGEST_NARROW, INGEST_WIDE } from "~/app/ingest/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { CliLog } from "~/components/ingest/cli-log";
import { FileList } from "~/components/ingest/file-list";
import { InfoPane } from "~/components/ingest/info-pane";
import { RunFeed } from "~/components/ingest/run-feed";
import { SelectionProvider } from "~/components/ingest/selection";
import { ledgerHead, toFailure } from "~/server/head";
import { HydrateClient, prefetch, trpc } from "~/trpc/server";

export const metadata: Metadata = { title: "Ingest · Corgi CFO" };

// The pipeline moves while the page is open; a build-time snapshot would lie.
export const dynamic = "force-dynamic";

export default async function IngestPage() {
  /**
   * The head read the status bar already pays for (request-cached, so this
   * costs no extra spawn) doubles as the health probe: a broken ledger is one
   * setup screen, not four pane-local errors.
   */
  const probe = await ledgerHead().then(
    () => null,
    (cause: unknown) => toFailure(cause),
  );
  if (probe !== null && !probe.ok) {
    return (
      <SetupCard reason={probe.error.reason} message={probe.error.message} />
    );
  }

  /**
   * Awaited, so the panes render their rows in this pass and hydrate onto them.
   * Each read is the one the pane would otherwise issue on mount; the inputs
   * match the panes' own so all three ride the same two cache entries.
   */
  await Promise.all([
    prefetch(trpc.ledger.ingest.list.queryOptions(undefined)),
    prefetch(trpc.ledger.questions.list.queryOptions({})),
  ]);

  // Without a key the page keeps its manual actions and says so, as everywhere.
  const enabled = isAiEnabled();

  return (
    <SelectionProvider>
      <div className="flex min-h-full flex-col @4xl/main:h-full">
        <Breadcrumbs crumbs={[{ label: "Ingest" }]} />
        <h1 className="sr-only">Ingest</h1>
        <HydrateClient>
          <div className={INGEST_GRID}>
            <FileList enabled={enabled} className={INGEST_NARROW} />
            <RunFeed enabled={enabled} className={INGEST_WIDE} />
            <InfoPane className={INGEST_WIDE} />
            <CliLog className={INGEST_NARROW} />
          </div>
        </HydrateClient>
      </div>
    </SelectionProvider>
  );
}
