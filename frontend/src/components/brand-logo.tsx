import { cn } from '@/lib/utils';

export function BrandLogo({
  className,
  inverted = false,
}: {
  className?: string;
  /** White text for the navy sidebar. */
  inverted?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span
        aria-hidden
        className="grid size-9 place-items-center rounded-lg bg-brand-orange text-base font-bold text-brand-navy"
      >
        TM
      </span>
      <span className="leading-tight">
        <span
          className={cn(
            'block text-[15px] font-semibold',
            inverted ? 'text-white' : 'text-brand-navy',
          )}
        >
          Ticaret Merkezi
        </span>
        <span
          className={cn(
            'block text-xs',
            inverted ? 'text-sidebar-foreground/70' : 'text-muted-foreground',
          )}
        >
          Yönetim Paneli
        </span>
      </span>
    </div>
  );
}
