import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';
import { cn } from '../lib/cn';

const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm font-medium transition-colors ease-out select-none disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-on-accent hover:opacity-90',
        secondary: 'bg-surface text-fg hairline hover:bg-surface-2',
        ghost: 'text-fg hover:bg-surface-2',
        destructive: 'bg-danger text-on-accent hover:opacity-90',
        link: 'min-h-0 px-0 text-accent underline-offset-4 hover:underline',
      },
      size: {
        default: '',
        sm: 'min-h-9 px-3 text-sm',
        lg: 'min-h-12 px-6 text-base',
        icon: 'min-h-11 w-11 px-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
