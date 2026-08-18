import { INGEST_GRID, INGEST_NARROW, INGEST_WIDE } from "~/app/ingest/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { PaneFrame } from "~/components/pane-frame";

/**
 * Soft on purpose: the ingest grid holds every pane's height, so the frames
 * alone are the placeholder. The oled pane keeps its real first line because
 * that is what cli-log.tsx paints before the first call too.
 */
export default function IngestLoading() {
  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Ingest" }]} />
      <h1 className="sr-only">Ingest</h1>
      <div className={INGEST_GRID}>
        <PaneFrame title="Files" className={INGEST_NARROW} />
        <PaneFrame title="Run" className={INGEST_WIDE} />
        <PaneFrame title="Info" className={INGEST_WIDE} />
        <PaneFrame
          title="oled"
          className={INGEST_NARROW}
          bodyClassName="min-h-0 flex-1 p-0"
        >
          <div className="h-full overflow-y-auto px-3 py-2">
            <p className="text-muted-foreground text-xs">
              Every oled call this server makes lands here.
            </p>
          </div>
        </PaneFrame>
      </div>
    </div>
  );
}
