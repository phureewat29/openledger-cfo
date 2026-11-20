"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

/** Which face of a file the info pane is showing. */
type InfoMode = "document" | "questions";

interface Selection {
  /**
   * Keyed by rel_path, not file id: a file has one before the ledger registers it
   * and keeps the same one after — a pick survives the prepare that would change its id.
   */
  readonly selected: ReadonlySet<string>;
  readonly toggle: (relPath: string) => void;
  /** Replaces the pick wholesale — select-all hands in the queue's paths. */
  readonly selectAll: (relPaths: readonly string[]) => void;
  readonly clear: () => void;
  /** What the info pane reads. Preparing and View drive this, not picking. */
  readonly viewerFileId: string | null;
  readonly viewerMode: InfoMode;
  readonly view: (fileId: string | null, mode?: InfoMode) => void;
}

const SelectionContext = createContext<Selection | null>(null);

const NOTHING: ReadonlySet<string> = new Set();

interface Viewer {
  readonly fileId: string | null;
  readonly mode: InfoMode;
}

const CLOSED: Viewer = { fileId: null, mode: "document" };

// In memory, not the URL: the page is force-dynamic, so a navigation re-runs its `oled` reads.
export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(NOTHING);
  const [viewer, setViewer] = useState<Viewer>(CLOSED);

  const value = useMemo<Selection>(
    () => ({
      selected,
      toggle: (relPath) =>
        setSelected((current) => {
          const next = new Set(current);
          if (!next.delete(relPath)) next.add(relPath);
          return next;
        }),
      selectAll: (relPaths) => setSelected(new Set(relPaths)),
      clear: () => setSelected(NOTHING),
      viewerFileId: viewer.fileId,
      viewerMode: viewer.mode,
      view: (fileId, mode = "document") => setViewer({ fileId, mode }),
    }),
    [selected, viewer],
  );

  return <SelectionContext value={value}>{children}</SelectionContext>;
}

export function useSelection(): Selection {
  const selection = useContext(SelectionContext);
  if (selection === null) {
    throw new Error("useSelection must be used inside a SelectionProvider");
  }
  return selection;
}

export function useQueueRefresh(): () => void {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries(trpc.ledger.ingest.list.queryFilter());
    void queryClient.invalidateQueries(
      trpc.ledger.questions.list.queryFilter(),
    );
  };
}
