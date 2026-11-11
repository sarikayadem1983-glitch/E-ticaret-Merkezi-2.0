import { STATUS_LABEL } from '@/lib/catalog';
import type { ProductStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<ProductStatus, string> = {
  draft: 'bg-amber-50 text-amber-800 ring-amber-200',
  active: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  archived: 'bg-muted text-muted-foreground ring-border',
};

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1',
        STATUS_STYLE[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Native select: keyboard, screen reader and mobile pickers work out of the
 * box. Styled like the Input component, at least 40px tall for touch.
 */
export function NativeSelect({
  className,
  ...props
}: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
