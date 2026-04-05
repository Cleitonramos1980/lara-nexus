import { cn } from '@/lib/utils';

const riskColors = {
  baixo: 'bg-emerald-100 text-emerald-800',
  medio: 'bg-amber-100 text-amber-800',
  alto: 'bg-orange-100 text-orange-800',
  critico: 'bg-red-100 text-red-800',
};

const riskLabels = {
  baixo: 'Baixo',
  medio: 'Médio',
  alto: 'Alto',
  critico: 'Crítico',
};

interface RiskBadgeProps {
  risk: 'baixo' | 'medio' | 'alto' | 'critico';
  className?: string;
}

export function RiskBadge({ risk, className }: RiskBadgeProps) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", riskColors[risk], className)}>
      {riskLabels[risk]}
    </span>
  );
}
