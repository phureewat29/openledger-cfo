"use client";

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

export function AssistantMessage({ children }: { children: React.ReactNode }) {
  return <div className={BODY}>{children}</div>;
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
