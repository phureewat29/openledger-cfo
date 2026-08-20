import type { Metadata } from "next";

import { ComingSoon } from "~/app/_components/coming-soon";
import { Breadcrumbs } from "~/components/breadcrumbs";

export const metadata: Metadata = { title: "Automation · OpenLedger CFO" };

export default function LoopPage() {
  return (
    <div className="flex min-h-full flex-col">
      <Breadcrumbs crumbs={[{ label: "Automation" }]} />
      <h1 className="sr-only">Automation</h1>
      <ComingSoon
        hook="Optimization on your own Money."
        body="Automation that reads every transaction you have, finds the leaks and the habits, and comes back with a guideline you can follow."
      />
    </div>
  );
}
