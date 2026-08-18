"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";

import { Button } from "@openledger-cfo/ui/button";
import { Pane } from "@openledger-cfo/ui/pane";

/**
 * Every pane on these pages sits inside an `@container`, which makes its
 * ancestor the containing block for anything fixed — a hand-rolled overlay
 * lands inside the column it came from. A native modal renders in the top
 * layer, which is outside all of it, and brings the focus trap, the focus
 * restore, inerting the page behind and Escape with it.
 */
export function ChartPane({
  title,
  meta,
  expandable = true,
  className,
  bodyClassName,
  children,
  expandedChildren,
}: {
  title: string;
  meta?: React.ReactNode;
  /** A chart with nothing in it has nothing to magnify. */
  expandable?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
  /** The same chart given the room; falls back to the pane's own view. */
  expandedChildren?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (expanded) element.showModal();
    // Also the route-change exit: closing is what hands focus back.
    return () => element.close();
  }, [expanded]);

  return (
    <>
      <Pane
        title={title}
        meta={meta}
        className={className}
        bodyClassName={bodyClassName}
        actions={
          expandable ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Expand ${title}`}
              onClick={() => setExpanded(true)}
            >
              <Maximize2 size={13} strokeWidth={1.75} />
            </Button>
          ) : undefined
        }
      >
        {/* One live chart at a time: the pane keeps its place without keeping
            a second copy of the plot mounted behind the dialog. */}
        {expanded ? (
          <p className="text-muted-foreground p-2 text-xs">
            Expanded — Esc to close.
          </p>
        ) : (
          children
        )}
      </Pane>

      {expandable ? (
        <dialog
          ref={dialog}
          aria-label={title}
          onClose={() => setExpanded(false)}
          onClick={(event) => {
            if (event.target === dialog.current) setExpanded(false);
          }}
          className="bg-background text-foreground fixed inset-0 m-0 h-full max-h-none w-full max-w-none overscroll-contain border-0 p-6 open:flex open:flex-col"
        >
          {expanded ? (
            <>
              <div className="flex h-6 shrink-0 items-center justify-between gap-3">
                <span className="label">{title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {meta === undefined ? null : (
                    <span className="text-muted-foreground text-[10px] tracking-[0.12em] uppercase tabular-nums">
                      {meta}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded(false)}
                  >
                    Close
                  </Button>
                </span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col pt-3">
                {expandedChildren ?? children}
              </div>
            </>
          ) : null}
        </dialog>
      ) : null}
    </>
  );
}
