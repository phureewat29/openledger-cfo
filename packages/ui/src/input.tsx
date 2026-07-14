import { cn } from "./index";

const FIELD =
  "border-border bg-card focus-visible:outline-ring h-8 rounded-md border px-2.5 text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-2";

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input data-slot="input" className={cn(FIELD, className)} {...props} />
  );
}

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(FIELD, "cursor-pointer", className)}
      {...props}
    />
  );
}

export { Input, Select };
