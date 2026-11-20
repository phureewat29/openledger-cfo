import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ACCOUNT_ID_PATTERN } from "@openledger-cfo/openledger/ids";
import { Pane } from "@openledger-cfo/ui/pane";

import { loadAccount } from "~/accounts/account";
import { AccountHead } from "~/accounts/account-head";
import { ACCOUNT_GRID, POSTINGS_COL } from "~/accounts/grid";
import { PAGE_SIZE } from "~/accounts/paging";
import { PostingsTable } from "~/accounts/postings-table";
import { VizRow } from "~/accounts/viz-row";
import { Breadcrumbs } from "~/app/_components/breadcrumbs";
import { SetupCard } from "~/app/_components/setup-card";
import { asLedgerLoad } from "~/ledger/load";
import { formatDay } from "~/lib/format";
import { HydrateClient, prefetch, trpc } from "~/trpc/server";

// The ledger is read per request; a build-time snapshot would go stale.
export const dynamic = "force-dynamic";

const idOf = async (params: Promise<{ id: string }>) =>
  decodeURIComponent((await params).id);

export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const id = await idOf(props.params);
  if (!ACCOUNT_ID_PATTERN.test(id))
    return { title: "Account · OpenLedger CFO" };
  const loaded = await asLedgerLoad(loadAccount(id));
  const name = loaded.ok ? loaded.value?.name : undefined;
  return { title: `${name ?? "Account"} · OpenLedger CFO` };
}

export default async function AccountPage(props: {
  params: Promise<{ id: string }>;
}) {
  const id = await idOf(props.params);
  if (!ACCOUNT_ID_PATTERN.test(id)) notFound();

  const loaded = await asLedgerLoad(loadAccount(id));
  if (!loaded.ok) {
    return (
      <SetupCard reason={loaded.error.reason} message={loaded.error.message} />
    );
  }

  const account = loaded.value;
  if (account === null) notFound();

  // Not awaited: the charts above are already drawn from `account`, so the
  // postings can arrive on the stream behind them.
  void prefetch(
    trpc.ledger.transactions.list.queryOptions({
      account: id,
      limit: PAGE_SIZE,
      offset: 0,
    }),
  );

  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs
        crumbs={[
          { label: "Accounts", href: "/accounts" },
          { label: account.name },
        ]}
      />
      <div className={ACCOUNT_GRID}>
        <AccountHead account={account} className="col-span-12" />
        <VizRow account={account} />
        <Pane
          title="Postings"
          meta={`through ${formatDay(account.asOf)}`}
          className={POSTINGS_COL}
          bodyClassName="flex min-h-0 flex-1 flex-col p-0"
        >
          <HydrateClient>
            <PostingsTable account={account.id} currency={account.currency} />
          </HydrateClient>
        </Pane>
      </div>
    </div>
  );
}
