import type { Metadata } from "next";

import { readGateway } from "@openledger-cfo/api";

import { Breadcrumbs } from "~/app/_components/breadcrumbs";
import { SetupCard } from "~/app/_components/setup-card";
import { INGEST_GRID, INGEST_NARROW, INGEST_WIDE } from "~/app/ingest/grid";
import { FileList } from "~/ingest/file-list";
import { InfoPane } from "~/ingest/info-pane";
import { RunFeed } from "~/ingest/run-feed";
import { SelectionProvider } from "~/ingest/selection";
import { asLedgerLoad, ledgerHead } from "~/ledger/load";
import { CliLog } from "~/shell/cli-log-pane";
import { HydrateClient, prefetch, trpc } from "~/trpc/server";

export const metadata: Metadata = { title: "Ingest · OpenLedger CFO" };

// The pipeline moves while the page is open; a build-time snapshot would lie.
export const dynamic = "force-dynamic";

export default async function IngestPage() {
  // The request-cached head read doubles as the probe: a broken ledger is one setup screen.
  const probe = await asLedgerLoad(ledgerHead());
  if (!probe.ok) {
    return (
      <SetupCard reason={probe.error.reason} message={probe.error.message} />
    );
  }

  // Inputs match the panes' own reads, so all three hydrate onto these two cache entries.
  await Promise.all([
    prefetch(trpc.ledger.ingest.list.queryOptions(undefined)),
    prefetch(trpc.ledger.questions.list.queryOptions({})),
  ]);

  // Without a gateway the page keeps its manual actions and says so, as everywhere.
  const enabled = (await readGateway()) !== undefined;

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
