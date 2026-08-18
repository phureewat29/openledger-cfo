/**
 * The month row under a column chart. Labels repeat once a window crosses a
 * year, so the key carries the slot rather than the name.
 */
export function MonthAxis({ labels }: { labels: readonly string[] }) {
  return (
    <div className="flex shrink-0 gap-1">
      {labels.map((label, index) => (
        <span
          key={`${index}-${label}`}
          className="text-muted-foreground min-w-0 flex-1 truncate text-center text-[10px]"
        >
          {label}
        </span>
      ))}
    </div>
  );
}
