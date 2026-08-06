"use client";

import { createContext, useContext, useMemo, useState } from "react";

/** Which face of a file the info pane is showing. */
export type InfoMode = "document" | "questions";

interface Selection {
  /**
   * The rows the operator picked, keyed by rel_path: a file has one of those
   * before the ledger registers it and keeps the same one afterwards, so a
   * pick survives the prepare that would change its id.
   */
  readonly selected: ReadonlySet<string>;
  readonly toggle: (relPath: string) => void;
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

/**
 * Two selections, kept apart on purpose: what the operator is acting on and
 * what they are reading. Both stay in memory instead of the URL — this page is
 * force-dynamic, so a navigation would re-run the `oled` reads behind it on
 * every click.
 */
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
      clear: () => setSelected(NOTHING),
      viewerFileId: viewer.fileId,
      viewerMode: viewer.mode,
      view: (fileId, mode = "document") => setViewer({ fileId, mode }),
    }),
    [selected, viewer],
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection(): Selection {
  const selection = useContext(SelectionContext);
  if (selection === null) {
    throw new Error("useSelection must be used inside a SelectionProvider");
  }
  return selection;
}
