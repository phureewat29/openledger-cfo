"use client";

import { createContext, useContext, useMemo, useRef, useState } from "react";

import { ConfigDialog } from "./config-dialog";
import { settleFocus } from "./focus";

interface ConfigDialogControl {
  readonly open: () => void;
}

const ConfigDialogContext = createContext<ConfigDialogControl | null>(null);

/**
 * One dialog for the whole app: the header chip, the chat CTA, the status bar
 * and the run pane all open the same instance — one DOM copy, one settings
 * fetch, no matter who asked.
 */
export function ConfigDialogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showing, setShowing] = useState(false);
  const trigger = useRef<Element | null>(null);
  const control = useMemo(
    () => ({
      open: () => {
        trigger.current = document.activeElement;
        setShowing(true);
      },
    }),
    [],
  );

  const close = () => {
    setShowing(false);
    // A route change can unmount CTA triggers; the native focus restore then
    // lands on <body>. (The save path settles focus itself — its trigger is
    // still connected at this moment and only unmounts when refresh lands.)
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) return;
      settleFocus();
    });
  };

  return (
    <ConfigDialogContext.Provider value={control}>
      {children}
      <ConfigDialog open={showing} onClose={close} />
    </ConfigDialogContext.Provider>
  );
}

export function useConfigDialog(): ConfigDialogControl {
  const control = useContext(ConfigDialogContext);
  if (control === null) {
    throw new Error(
      "useConfigDialog must be used inside a ConfigDialogProvider",
    );
  }
  return control;
}
