import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ACCOUNT_ID_PATTERN } from "@openledger-fleet/api";
import { Pane } from "@openledger-fleet/ui/pane";

import { AccountHead } from "~/components/account/account-head";
import { PAGE_SIZE } from "~/components/account/paging";
import { PostingsTable } from "~/components/account/postings-table";
import { VizRow } from "~/components/account/viz-row";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { formatDay } from "~/domain/format";
import { loadAccount } from "~/server/account";
import { HydrateClient, prefetch, trpc } from "~/trpc/server";

// The ledger is read per request; a build-time snapshot would go stale.
export const dynamic = "force-dynamic";

const idOf = async (params: Promise<{ id: string }>) =>
  decodeURIComponent((await params).id);

export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const id = await idOf(props.params);
  if (!ACCOUNT_ID_PATTERN.test(id)) return { title: "Account · Corgi CFO" };
  const account = await loadAccount(id);
  return { title: `${account?.name ?? "Account"} · Corgi CFO` };
}

export default async function AccountPage(props: {
  params: Promise<{ id: string }>;
}) {
  const id = await idOf(props.params);
  if (!ACCOUNT_ID_PATTERN.test(id)) notFound();

  const account = await loadAccount(id);
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
      {/* Fractional rows only resolve against a definite height, which is what
          `flex-1` hands them; left content-sized, the postings list would scale
          the charts above it. The floors still scroll a short window. */}
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 p-3 @4xl/main:grid-rows-[auto_minmax(280px,1fr)_minmax(300px,1.1fr)]">
        <AccountHead account={account} className="col-span-12" />
        <VizRow account={account} />
        <Pane
          title="Postings"
          meta={`through ${formatDay(account.asOf)}`}
          className="col-span-12 @2xl/main:h-[360px] @4xl/main:h-auto"
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
