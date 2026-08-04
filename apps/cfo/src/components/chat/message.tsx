"use client";

import { cn } from "@openledger-fleet/ui";

const DOT_DELAYS = ["0ms", "150ms", "300ms"];

/** The same size the answer renders at: one column, one body size. */
const BODY = "min-w-0 flex-1 text-sm leading-5";

export function UserMessage({
  children,
  anchor,
}: {
  children: React.ReactNode;
  /** The question the scroller measures the current turn from. */
  anchor?: boolean;
}) {
  return (
    <div
      data-turn-anchor={anchor ? "" : undefined}
      className="text-accent flex gap-2"
    >
      <span aria-hidden className="shrink-0 text-sm leading-5">
        ›
      </span>
      <div className={BODY}>{children}</div>
    </div>
  );
}

export function AssistantMessage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn(BODY, className)}>{children}</div>;
}

/** One quiet block for everything the model did before it answered. */
export function ToolGroup({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-border ml-2 flex flex-col gap-0.5 border-l pl-2">
      {children}
    </span>
  );
}

export function ToolNotice({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground text-[10px]">{children}</span>;
}

export function CommandNotice({ command }: { command: string }) {
  return (
    <span
      className="text-muted-foreground truncate text-[10px]"
      title={command}
    >
      $ {command}
    </span>
  );
}

export function Thinking() {
  return (
    <AssistantMessage>
      <span className="flex items-center gap-1.5 py-2">
        {DOT_DELAYS.map((delay) => (
          <span
            key={delay}
            className="bg-muted-foreground size-1.5 animate-bounce rounded-full"
            style={{ animationDelay: delay }}
          />
        ))}
      </span>
    </AssistantMessage>
  );
}
