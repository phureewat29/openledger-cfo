import { cn } from "./index";

function Pane({
  title,
  meta,
  actions,
  scroll = false,
  className,
  bodyClassName,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  /** Shadows the HTML attribute: the header renders it, a tooltip does not. */
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  scroll?: boolean;
  bodyClassName?: string;
}) {
  return (
    <section
      data-slot="pane"
      className={cn(
        "border-border bg-card flex min-h-0 flex-col overflow-hidden rounded-lg border",
        className,
      )}
      {...props}
    >
      <header className="border-border flex h-8 shrink-0 items-center justify-between gap-3 border-b px-3">
        {/* Titles are short and load-bearing; the meta is the half that yields. */}
        <span className="label shrink-0 truncate">{title}</span>
        {meta === undefined && actions === undefined ? null : (
          // The meta yields before an action does: a clipped figure still has
          // its pane behind it, a clipped button is gone.
          <span className="flex min-w-0 items-center gap-2">
            {meta === undefined ? null : (
              <span className="text-muted-foreground min-w-0 truncate text-[10px] tracking-[0.12em] uppercase tabular-nums">
                {meta}
              </span>
            )}
            {actions}
          </span>
        )}
      </header>
      <div
        className={cn(
          "min-h-0 p-3",
          scroll && "flex-1 overflow-y-auto",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export { Pane };
