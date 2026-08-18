import type { Metadata } from "next";

import { ComingSoon } from "~/app/_components/coming-soon";
import { Breadcrumbs } from "~/components/breadcrumbs";

export const metadata: Metadata = { title: "Loop · OpenLedger CFO" };

export default function LoopPage() {
  return (
    <div className="flex min-h-full flex-col">
      <Breadcrumbs crumbs={[{ label: "Loop" }]} />
      <h1 className="sr-only">Loop</h1>
      <ComingSoon
        hook="Optimization on your own Money."
        body="Build the loop that reads every transactions you have, finds the leaks and the habits, and comes back with a guideline you can follow."
      />
    </div>
  );
}
