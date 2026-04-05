import { AlertTriangle, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AlertCardProps {
  type: 'warning' | 'error' | 'info';
  title: string;
  description: string;
}

const alertConfig = {
  warning: { icon: AlertTriangle, bg: 'bg-amber-50 border-amber-200', iconColor: 'text-amber-600', titleColor: 'text-amber-800' },
  error: { icon: XCircle, bg: 'bg-red-50 border-red-200', iconColor: 'text-red-600', titleColor: 'text-red-800' },
  info: { icon: Info, bg: 'bg-blue-50 border-blue-200', iconColor: 'text-blue-600', titleColor: 'text-blue-800' },
};

export function AlertCard({ type, title, description }: AlertCardProps) {
  const cfg = alertConfig[type];
  const Icon = cfg.icon;
  return (
    <div className={cn("flex items-start gap-3 p-3 rounded-lg border", cfg.bg)}>
      <Icon className={cn("h-5 w-5 mt-0.5 shrink-0", cfg.iconColor)} />
      <div>
        <p className={cn("text-sm font-semibold", cfg.titleColor)}>{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}
