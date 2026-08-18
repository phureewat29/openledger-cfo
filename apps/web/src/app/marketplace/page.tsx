import type { Metadata } from "next";

import { ComingSoon } from "~/app/_components/coming-soon";
import { Breadcrumbs } from "~/components/breadcrumbs";

export const metadata: Metadata = { title: "Marketplace · OpenLedger CFO" };

export default function MarketplacePage() {
  return (
    <div className="flex min-h-full flex-col">
      <Breadcrumbs crumbs={[{ label: "Marketplace" }]} />
      <h1 className="sr-only">Marketplace</h1>
      <ComingSoon
        hook="Plugins for your Ledger, Installed locally."
        body="Money coach, tax helpers, subscription killers, forecasters that know your numbers. Every plugin runs on your machine, works straight on your own transactions."
      />
    </div>
  );
}
