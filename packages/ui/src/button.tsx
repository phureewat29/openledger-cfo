import type { VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";

import { cn } from "./index";

const buttonVariants = cva(
  "focus-visible:outline-ring inline-flex cursor-pointer items-center justify-center rounded-md text-xs font-medium whitespace-nowrap transition duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground hover:brightness-[0.97]",
        ghost: "text-muted-foreground hover:text-foreground hover:bg-secondary",
        outline: "border-border hover:bg-secondary border bg-transparent",
      },
      size: {
        sm: "h-7 px-3 text-xs",
        default: "h-8 px-4 text-xs",
        icon: "size-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button };
