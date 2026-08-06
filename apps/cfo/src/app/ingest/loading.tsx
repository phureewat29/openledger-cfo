import { INGEST_GRID, INGEST_NARROW, INGEST_WIDE } from "~/app/ingest/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { PaneFrame } from "~/components/pane-frame";

export default function IngestLoading() {
  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Ingest" }]} />
      <div className={INGEST_GRID}>
        <PaneFrame title="Files" className={INGEST_NARROW} />
        <PaneFrame title="Run" className={INGEST_WIDE} />
        <PaneFrame title="Info" className={INGEST_WIDE} />
        <PaneFrame title="oled" className={INGEST_NARROW} />
      </div>
    </div>
  );
}
