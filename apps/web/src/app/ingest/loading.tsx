import { INGEST_GRID, INGEST_NARROW, INGEST_WIDE } from "~/app/ingest/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { LoadingLine } from "~/components/loading-line";
import { PaneFrame } from "~/components/pane-frame";

/**
 * Soft on purpose: the ingest grid holds every pane's height, so the frames
 * alone are the placeholder. The dropzone strip and the oled first line stay
 * because they are fixed chrome — file-list.tsx and cli-log.tsx paint the
 * same ones before any data arrives — and Run's body padding mirrors
 * run-feed.tsx so its first line does not shift on swap.
 */
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
            <div className="border-border text-muted-foreground flex h-7 items-center rounded-md border border-dashed px-2 text-xs">
              Drop files, or click — PDF, PNG, JPG, WEBP
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
