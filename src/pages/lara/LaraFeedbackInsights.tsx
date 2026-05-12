import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { CardKPI } from '@/components/lara/CardKPI';
import { EmptyState } from '@/components/lara/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getInsightsFeedback } from '@/services/laraApi';
import { BarChart3, CheckCircle2, XCircle, Clock, TrendingUp } from 'lucide-react';

const ETAPAS = ['todas', 'D-3', 'D0', 'D+3', 'D+7', 'D+15', 'D+30'];
const PERIODOS = [7, 14, 30, 60, 90];

const RESULTADO_LABELS: Record<string, { label: string; color: string }> = {
  pagou:     { label: 'Pagou',       color: 'bg-emerald-500' },
  respondeu: { label: 'Respondeu',   color: 'bg-blue-500' },
  ignorou:   { label: 'Ignorou',     color: 'bg-slate-400' },
  optout:    { label: 'Opt-out',     color: 'bg-red-500' },
  escalou:   { label: 'Escalado',    color: 'bg-amber-500' },
};

export default function LaraFeedbackInsights() {
  const [etapa, setEtapa] = useState('todas');
  const [dias, setDias] = useState(30);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['lara-feedback-insights', etapa, dias],
    queryFn: () => getInsightsFeedback(etapa === 'todas' ? undefined : etapa, dias),
    staleTime: 120_000,
  });

  const totalResultados = data
    ? Object.values(data.por_resultado).reduce((s, v) => s + v, 0)
    : 0;

  return (
    <LaraLayout>
      <PageHeader
        title="Feedback & Insights"
        subtitle="Análise de conversão e efetividade das interações da régua"
      />

      <div className="flex flex-wrap gap-2 mb-5">
        <div className="flex gap-1">
          {ETAPAS.map((e) => (
            <Button
              key={e}
              size="sm"
              variant={etapa === e ? 'default' : 'outline'}
              className="text-xs h-7 px-2.5"
              onClick={() => setEtapa(e)}
            >
              {e}
            </Button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto">
          {PERIODOS.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={dias === d ? 'default' : 'outline'}
              className="text-xs h-7 px-2.5"
              onClick={() => setDias(d)}
            >
              {d}d
            </Button>
          ))}
        </div>
      </div>

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive mb-4">
          Falha ao carregar insights. Verifique se o backend está ativo.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-20" />
            </div>
          ))
        ) : data ? (
          <>
            <CardKPI
              title="Total Interações"
              value={data.total_interacoes}
              icon={<BarChart3 className="h-4 w-4" />}
            />
            <CardKPI
              title="Taxa de Conversão"
              value={`${data.taxa_conversao.toFixed(1)}%`}
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <CardKPI
              title="Pagamentos"
              value={data.por_resultado['pagou'] ?? 0}
              icon={<CheckCircle2 className="h-4 w-4" />}
            />
            <CardKPI
              title="Opt-outs"
              value={data.por_resultado['optout'] ?? 0}
              icon={<XCircle className="h-4 w-4" />}
            />
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-1">Distribuição de Resultados</h3>
          <p className="text-[11px] text-muted-foreground mb-4">
            Proporção de cada desfecho nos últimos {dias} dias
            {etapa !== 'todas' ? ` · etapa ${etapa}` : ''}
          </p>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : data && totalResultados > 0 ? (
            <div className="space-y-2.5">
              {Object.entries(data.por_resultado)
                .sort((a, b) => b[1] - a[1])
                .map(([key, qty]) => {
                  const meta = RESULTADO_LABELS[key] ?? { label: key, color: 'bg-primary' };
                  const pct = (qty / totalResultados) * 100;
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <Badge variant="outline" className="text-[10px] w-20 justify-center shrink-0">{meta.label}</Badge>
                      <div className="flex-1 h-5 bg-muted/40 rounded overflow-hidden">
                        <div
                          className={`h-full ${meta.color} rounded flex items-center pl-1.5 text-[10px] text-white`}
                          style={{ width: `${Math.max(6, pct)}%` }}
                        >
                          {qty}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground w-10 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  );
                })}
            </div>
          ) : (
            <EmptyState title="Sem dados" description="Nenhuma interação registrada no período." />
          )}
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-500" />
            Melhores Horários de Envio
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">
            Horários com maior taxa de resposta e conversão
          </p>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
            </div>
          ) : data?.melhores_horas?.length ? (
            <div className="grid grid-cols-2 gap-2">
              {data.melhores_horas
                .sort((a, b) => b.taxa - a.taxa)
                .slice(0, 8)
                .map((h) => (
                  <div
                    key={h.hora}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <span className="text-sm font-mono font-medium">{String(h.hora).padStart(2, '0')}:00</span>
                    <Badge
                      variant={h.taxa >= 0.3 ? 'default' : 'secondary'}
                      className="text-[10px]"
                    >
                      {(h.taxa * 100).toFixed(0)}%
                    </Badge>
                  </div>
                ))}
            </div>
          ) : (
            <EmptyState title="Sem dados" description="Nenhum dado de horário disponível." />
          )}
        </div>
      </div>
    </LaraLayout>
  );
}
