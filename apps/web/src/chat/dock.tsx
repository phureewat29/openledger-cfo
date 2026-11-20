"use client";

import { createContext, useContext, useMemo, useState } from "react";

interface Dock {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}

const DockContext = createContext<Dock | null>(null);

/**
 * Below `lg` the chat is an overlay the rail toggles. The state lives above
 * both so the pane is never keyed on a route and never remounts mid-answer.
 */
export function ChatDock({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);

  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

export function useChatDock(): Dock {
  const dock = useContext(DockContext);
  if (dock === null) {
    throw new Error("useChatDock must be used inside a ChatDock");
  }
  return dock;
}
