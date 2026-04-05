import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CardKPIProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  trend?: { value: string; positive: boolean };
  className?: string;
}

export function CardKPI({ label, value, icon, trend, className }: CardKPIProps) {
  return (
    <div className={cn("rounded-lg border bg-card p-4 shadow-sm", className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="text-2xl font-bold text-foreground">{value}</span>
        {trend && (
          <span className={cn("text-xs font-medium mb-0.5", trend.positive ? "text-lara-success" : "text-lara-critical")}>
            {trend.value}
          </span>
        )}
      </div>
    </div>
  );
}
