import { cn } from "@openledger-cfo/ui";

/** A form field always names itself; the name is the affordance. */
export function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
