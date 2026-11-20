import { Breadcrumbs } from "~/app/_components/breadcrumbs";
import { PaneFrame } from "~/app/_components/pane-frame";
import { INGEST_GRID, INGEST_NARROW, INGEST_WIDE } from "~/app/ingest/grid";
import { UPLOAD_HINT } from "~/ingest/files";
import { LoadingLine } from "~/lib/ui/loading-line";

// The dropzone strip and the oled first line are the panes' own fixed chrome, and Run's padding mirrors the feed's.
export default function IngestLoading() {
  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Ingest" }]} />
      <h1 className="sr-only">Ingest</h1>
      <div className={INGEST_GRID}>
        <PaneFrame
          title="Files"
          className={INGEST_NARROW}
          bodyClassName="flex min-h-0 flex-1 flex-col p-0"
        >
          <div className="border-border shrink-0 border-b p-2">
            <div className="border-border text-muted-foreground flex min-h-7 items-center rounded-md border border-dashed px-2 py-1 text-xs">
              {UPLOAD_HINT}
            </div>
          </div>
          <div className="min-h-0 flex-1 p-3">
            <LoadingLine />
          </div>
        </PaneFrame>

        <PaneFrame
          title="Run"
          className={INGEST_WIDE}
          bodyClassName="min-h-0 flex-1 px-3 py-2"
        />

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
