import { INGEST_GRID, INGEST_NARROW, INGEST_WIDE } from "~/app/ingest/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { LoadingLine } from "~/components/loading-line";
import { PaneFrame } from "~/components/pane-frame";
import { Shimmer, ShimmerBox } from "~/components/skeleton";

/**
 * Shells mirror ingest/file-list.tsx (dropzone strip and row heights) and
 * cli-log.tsx (whose empty line is the real first paint); the file rows are a
 * queue's worth. Edit those components and this file together.
 */
const FILES = [
  "w-[22ch]",
  "w-[18ch]",
  "w-[25ch]",
  "w-[15ch]",
  "w-[20ch]",
  "w-[24ch]",
];

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
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ul className="divide-border divide-y">
              {FILES.map((name, rank) => (
                <li key={rank} className="px-3 py-1">
                  <div className="flex min-h-7 items-center gap-2">
                    <ShimmerBox className="size-3.5 shrink-0 rounded-sm" />
                    <Shimmer className={`text-xs ${name}`} />
                    <Shimmer className="ml-auto w-[6ch] rounded-sm px-1.5 text-[10px]" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </PaneFrame>

        <PaneFrame
          title="Run"
          className={INGEST_WIDE}
          bodyClassName="flex min-h-0 flex-1 flex-col p-0"
        >
          <div className="px-3 py-2">
            <LoadingLine />
          </div>
        </PaneFrame>

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
