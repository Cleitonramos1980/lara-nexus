import { cn } from '@/lib/utils';

const sevColors = {
  sucesso: 'bg-emerald-100 text-emerald-800',
  aviso: 'bg-amber-100 text-amber-800',
  erro: 'bg-red-100 text-red-800',
  bloqueado: 'bg-slate-200 text-slate-700',
};

const sevLabels = {
  sucesso: 'Sucesso',
  aviso: 'Aviso',
  erro: 'Erro',
  bloqueado: 'Bloqueado',
};

interface SeverityBadgeProps {
  severity: 'sucesso' | 'aviso' | 'erro' | 'bloqueado';
  className?: string;
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", sevColors[severity], className)}>
      {sevLabels[severity]}
    </span>
  );
}
