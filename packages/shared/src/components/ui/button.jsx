/* eslint-disable react-refresh/only-export-components */
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "../../lib/utils.js"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-none hover:bg-primary/94 dark:shadow-[0_8px_24px_rgba(255,255,255,0.08)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-none hover:bg-destructive/92 dark:shadow-[0_8px_24px_rgba(255,79,79,0.18)]",
        outline:
          "border border-input bg-transparent text-foreground shadow-none hover:border-border hover:bg-accent/70 hover:text-accent-foreground dark:bg-card/80 dark:shadow-[0_10px_28px_rgba(0,0,0,0.22)]",
        secondary:
          "bg-secondary text-secondary-foreground shadow-none hover:bg-secondary/88 dark:shadow-[0_10px_28px_rgba(0,0,0,0.2)]",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, type, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      type={asChild ? type : type || "button"}
      {...props}
    />
  );
});
Button.displayName = "Button";

export { Button, buttonVariants }
