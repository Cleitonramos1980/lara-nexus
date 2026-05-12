import { cn } from '@/lib/utils';

const etapaColors: Record<string, string> = {
  'D-3': 'bg-sky-100 text-sky-800',
  'D0': 'bg-blue-100 text-blue-800',
  'D+3': 'bg-indigo-100 text-indigo-800',
  'D+7': 'bg-violet-100 text-violet-800',
  'D+15': 'bg-orange-100 text-orange-800',
  'D+30': 'bg-red-100 text-red-800',
};

interface EtapaReguaBadgeProps {
  etapa: string;
  className?: string;
}

export function EtapaReguaBadge({ etapa, className }: EtapaReguaBadgeProps) {
  if (!etapa || etapa === '-') return <span className="text-xs text-muted-foreground">—</span>;
  const colors = etapaColors[etapa] || 'bg-gray-100 text-gray-700';
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold font-mono", colors, className)}>
      {etapa}
    </span>
  );
}
