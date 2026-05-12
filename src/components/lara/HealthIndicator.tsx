import { cn } from '@/lib/utils';

interface HealthIndicatorProps {
  label: string;
  status: 'operacional' | 'degradado' | 'falha';
  detail?: string;
}

const statusConfig = {
  operacional: { color: 'bg-emerald-500', text: 'Operacional', textColor: 'text-emerald-700' },
  degradado: { color: 'bg-amber-500', text: 'Degradado', textColor: 'text-amber-700' },
  falha: { color: 'bg-red-500', text: 'Falha', textColor: 'text-red-700' },
};

export function HealthIndicator({ label, status, detail }: HealthIndicatorProps) {
  const cfg = statusConfig[status];
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
      <div className="flex items-center gap-3">
        <span className={cn("h-3 w-3 rounded-full animate-pulse", cfg.color)} />
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>
      <div className="text-right">
        <span className={cn("text-xs font-semibold", cfg.textColor)}>{cfg.text}</span>
        {detail && <p className="text-[10px] text-muted-foreground">{detail}</p>}
      </div>
    </div>
  );
}
