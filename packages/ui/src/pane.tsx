import { cn } from "./index";

function Pane({
  title,
  meta,
  actions,
  className,
  bodyClassName,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  /** Shadows the HTML attribute: the header renders it, a tooltip does not. */
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
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
        {/* The title never shrinks; the meta yields before an action does. */}
        <span className="label shrink-0 truncate">{title}</span>
        {meta === undefined && actions === undefined ? null : (
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
      <div className={cn("min-h-0 p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

export { Pane };
