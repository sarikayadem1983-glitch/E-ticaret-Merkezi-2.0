import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  type OrderStatus,
  type StatusTone,
} from '@/lib/orders';
import { cn } from '@/lib/utils';

const TONE_STYLE: Record<StatusTone, string> = {
  neutral: 'bg-slate-50 text-slate-700 ring-slate-200',
  progress: 'bg-sky-50 text-sky-800 ring-sky-200',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-800 ring-red-200',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1',
        TONE_STYLE[ORDER_STATUS_TONE[status]],
      )}
    >
      {ORDER_STATUS_LABEL[status]}
    </span>
  );
}
