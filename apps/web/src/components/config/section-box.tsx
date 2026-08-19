import { cn } from "@openledger-cfo/ui";

export interface Line {
  readonly tone: "muted" | "accent" | "destructive";
  /** Short, it sits on the box line; anything longer goes in `detail`. */
  readonly word: string;
  readonly detail?: string;
}

const TONE: Record<Line["tone"], { text: string; border: string }> = {
  muted: { text: "text-muted-foreground", border: "border-border" },
  accent: { text: "text-accent", border: "border-accent" },
  destructive: { text: "text-destructive", border: "border-destructive" },
};

/**
 * The frame carries the verdict: the border turns green or red and the word
 * sits on the box line; details print inside. The status span is always
 * mounted so the live region exists before it has anything to say.
 */
export function SectionBox({
  title,
  line,
  className,
  children,
}: {
  title: string;
  line: Line | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-md border px-3 pb-3",
        line === null ? "border-border" : TONE[line.tone].border,
        className,
      )}
    >
      <legend className="flex items-center gap-2 px-1">
        <span className="label">{title}</span>
        <span
          role="status"
          className={cn(
            "text-[11px]",
            line === null ? "" : TONE[line.tone].text,
          )}
        >
          {line?.word}
        </span>
      </legend>
      {children}
      {line?.detail === undefined ? null : (
        <p className="text-muted-foreground text-[11px] break-words">
          {line.detail}
        </p>
      )}
    </fieldset>
  );
}
