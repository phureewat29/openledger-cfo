"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@openledger-cfo/ui/button";

import { LoadingLine } from "~/components/loading-line";
import { useTRPC } from "~/trpc/react";
import { ConfigForm } from "./config-form";
import { settleFocus } from "./focus";

function Notice({
  headline,
  detail,
  command,
  onClose,
}: {
  headline: string;
  detail?: string;
  command?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-base font-medium">AI Gateway Config</h2>
      <p className="text-muted-foreground text-sm">{headline}</p>
      {command === undefined ? null : (
        <pre className="bg-secondary overflow-x-auto rounded-md p-3 text-sm">
          {command}
        </pre>
      )}
      {detail === undefined ? null : (
        <p className="text-muted-foreground text-[11px] break-words">
          {detail}
        </p>
      )}
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

const STORE_NOTICE: Record<
  "missing-table" | "unavailable",
  { headline: string; command?: string }
> = {
  "missing-table": {
    headline:
      "The control plane is missing its configuration table. Create it, then come back here.",
    command: "pnpm db:push",
  },
  unavailable: {
    headline: "The control plane did not answer. Reload and try again.",
  },
};

/** Mounted per opening so the form reseeds from a fresh read every time. */
function Body({
  onClose,
  onSaving,
}: {
  onClose: () => void;
  onSaving: (saving: boolean) => void;
}) {
  const trpc = useTRPC();
  const settings = useQuery(
    trpc.configuration.get.queryOptions(undefined, { staleTime: 0, gcTime: 0 }),
  );

  if (settings.isPending) {
    return (
      <div className="p-4">
        <LoadingLine />
      </div>
    );
  }
  if (settings.isError) {
    return (
      <Notice
        headline="The settings could not be read."
        detail={settings.error.message}
        onClose={onClose}
      />
    );
  }
  if (settings.data.store !== "ready") {
    return <Notice {...STORE_NOTICE[settings.data.store]} onClose={onClose} />;
  }
  return (
    <ConfigForm initial={settings.data} onClose={onClose} onSaving={onSaving} />
  );
}

/**
 * Panes sit inside `@container`s, which trap fixed overlays; a native modal
 * escapes to the top layer and brings focus trap and Escape with it.
 */
function ConfigDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // A save in flight; tests stay escapable.
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open) element.showModal();
    // Also the route-change exit: closing is what hands focus back.
    return () => element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-label="AI Gateway Config"
      // Every exit passes through close; the saving lock dies here.
      onClose={() => {
        setSaving(false);
        onClose();
      }}
      // Escape must not orphan an in-flight save.
      onCancel={(event) => {
        if (saving) event.preventDefault();
      }}
      onClick={(event) => {
        if (!saving && event.target === dialog.current) onClose();
      }}
      className="bg-card text-foreground border-border m-auto max-h-[calc(100vh-2rem)] w-[min(44rem,calc(100vw-2rem))] overflow-hidden rounded-lg border p-0 backdrop:bg-black/60"
    >
      {open ? <Body onClose={onClose} onSaving={setSaving} /> : null}
    </dialog>
  );
}

interface ConfigDialogControl {
  readonly open: () => void;
}

const ConfigDialogContext = createContext<ConfigDialogControl | null>(null);

/** One dialog instance for the whole app, whoever opens it. */
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
    // A route change can unmount the trigger; the native restore then lands
    // on <body>. (The save path settles focus itself.)
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
