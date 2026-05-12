import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { CardKPI } from '@/components/lara/CardKPI';
import { RiskBadge } from '@/components/lara/RiskBadge';
import { EtapaReguaBadge } from '@/components/lara/EtapaReguaBadge';
import { EmptyState } from '@/components/lara/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/data/lara-mock';
import {
  TrendingUp, AlertTriangle, Target, Users, Clock,
  Bell, PhoneCall, Calendar, CheckCircle2, XCircle,
} from 'lucide-react';
import { getDashboardPreditivo } from '@/services/laraApi';
import { useLaraFiliaisFilter } from '@/contexts/LaraFiliaisContext';

type PreditivoData = {
  gerado_em: string;
  carteira_total: number;
  clientes_prioritarios_hoje: {
    quantidade: number;
    valor_impactavel: number;
    lista: Array<{
      codcli: string;
      cliente: string;
      etapa_regua: string;
      risco: string;
      total_aberto: number;
      dias_sem_contato: number;
      prioridade_score: number;
    }>;
  };
  pipeline_conversao_7d: {
    valor_estimado: number;
    percentual_carteira: number;
    taxa_historica_usada: number;
    descricao: string;
  };
  promessas_vencendo_48h: {
    quantidade: number;
    valor_total: number;
    descricao: string;
  };
  tendencia_optout: {
    nivel: string;
    quantidade_7d: number;
    alerta: boolean;
  };
  melhor_janela_contato_hoje: {
    horas: number[];
    fonte: string;
  };
};

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (score / max) * 100) : 0;
  const color = pct >= 70 ? 'bg-red-500' : pct >= 40 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono w-8 text-right text-muted-foreground">{Math.round(pct)}%</span>
    </div>
  );
}

function formatHora(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

export default function LaraDashboardPreditivo() {
  const navigate = useNavigate();
  const { filiaisApiParam, selectedFiliaisKey } = useLaraFiliaisFilter();
  const filial = filiaisApiParam?.[0];

  const { data, isLoading, isError } = useQuery({
    queryKey: ['lara-dashboard-preditivo', selectedFiliaisKey],
    queryFn: () => getDashboardPreditivo(filial) as Promise<PreditivoData>,
    staleTime: 120_000,
  });

  const d = data as PreditivoData | undefined;
  const lista = d?.clientes_prioritarios_hoje?.lista ?? [];
  const maxScore = lista.reduce((m, c) => Math.max(m, c.prioridade_score), 1);
  const riscoCritico = lista.filter(c => c.risco === 'critico').length;
  const riscoAlto = lista.filter(c => c.risco === 'alto').length;

  return (
    <LaraLayout>
      <PageHeader
        title="Dashboard Preditivo"
        subtitle="Priorização inteligente de cobrança e previsão de recuperação"
      />

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive mb-4">
          Falha ao carregar dados preditivos. Verifique se o backend está ativo.
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-32" />
            </div>
          ))
        ) : d ? (
          <>
            <CardKPI
              label="Clientes Prioritários Hoje"
              value={d.clientes_prioritarios_hoje?.quantidade ?? 0}
              icon={<Users className="h-4 w-4" />}
              onClick={() => navigate('/lara/clientes')}
            />
            <CardKPI
              label="Valor Impactável"
              value={formatCurrency(d.clientes_prioritarios_hoje?.valor_impactavel ?? 0)}
              icon={<Target className="h-4 w-4" />}
              onClick={() => navigate('/lara/titulos')}
            />
            <CardKPI
              label="Previsão Recup. 7 dias"
              value={formatCurrency(d.pipeline_conversao_7d?.valor_estimado ?? 0)}
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <CardKPI
              label="Promessas Vencendo 48h"
              value={d.promessas_vencendo_48h?.quantidade ?? 0}
              icon={<Bell className="h-4 w-4" />}
              onClick={() => navigate('/lara/promessas')}
            />
          </>
        ) : null}
      </div>

      {/* Cards de análise */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Previsão de Recuperação */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            Previsão de Recuperação
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">Estimativa baseada em histórico de conversão</p>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : d ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Próximos 7 dias</p>
                  <p className="text-xl font-bold text-emerald-600">{formatCurrency(d.pipeline_conversao_7d?.valor_estimado ?? 0)}</p>
                  <p className="text-[10px] text-muted-foreground">{(d.pipeline_conversao_7d?.percentual_carteira ?? 0).toFixed(1)}% da carteira</p>
                </div>
                <Clock className="h-5 w-5 text-emerald-500" />
              </div>
              {d.promessas_vencendo_48h?.valor_total > 0 && (
                <div className="flex items-center justify-between p-3 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                  <div>
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Promessas 48h</p>
                    <p className="text-xl font-bold text-amber-600">{formatCurrency(d.promessas_vencendo_48h.valor_total)}</p>
                    <p className="text-[10px] text-muted-foreground">{d.promessas_vencendo_48h.quantidade} promessa{d.promessas_vencendo_48h.quantidade !== 1 ? 's' : ''}</p>
                  </div>
                  <Calendar className="h-5 w-5 text-amber-500" />
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Melhor Janela de Contato */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
            <PhoneCall className="h-4 w-4 text-blue-500" />
            Melhor Janela de Contato
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">Horários com maior taxa de resposta hoje</p>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : d?.melhor_janela_contato_hoje?.horas?.length ? (
            <div className="space-y-2">
              {d.melhor_janela_contato_hoje.horas.map((h, i) => (
                <div key={h} className={`flex items-center justify-between p-3 rounded-md border ${i === 0 ? 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800' : 'bg-muted/20 border-border/50'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold w-4 text-center ${i === 0 ? 'text-blue-600' : 'text-muted-foreground'}`}>{i + 1}º</span>
                    <span className={`text-lg font-bold font-mono ${i === 0 ? 'text-blue-600' : 'text-foreground'}`}>{formatHora(h)}</span>
                  </div>
                  {i === 0 && <span className="text-[10px] text-blue-600 font-medium bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">Recomendado</span>}
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground mt-1">Fonte: {d.melhor_janela_contato_hoje.fonte === 'padrao' ? 'padrão de mercado' : 'histórico de interações'}</p>
            </div>
          ) : <EmptyState title="Sem dados" description="Sem janela de contato disponível." />}
        </div>

        {/* Saúde da Carteira */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Saúde da Carteira
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">Composição por nível de risco</p>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : d ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-2 rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200/50">
                <span className="text-xs font-medium text-red-700 dark:text-red-400">Crítico</span>
                <span className="text-sm font-bold text-red-700 dark:text-red-400">{riscoCritico}</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-md bg-orange-50 dark:bg-orange-950/20 border border-orange-200/50">
                <span className="text-xs font-medium text-orange-700 dark:text-orange-400">Alto</span>
                <span className="text-sm font-bold text-orange-700 dark:text-orange-400">{riscoAlto}</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-md bg-muted/30 border border-border/40">
                <span className="text-xs font-medium text-muted-foreground">Total na lista</span>
                <span className="text-sm font-bold text-foreground">{lista.length}</span>
              </div>
              <div className={`flex items-center gap-2 p-2 rounded-md border mt-2 ${d.tendencia_optout?.alerta ? 'bg-red-50 dark:bg-red-950/20 border-red-200' : 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/50'}`}>
                {d.tendencia_optout?.alerta
                  ? <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                  : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                <span className="text-[11px] text-muted-foreground">
                  Opt-outs 7 dias: <strong>{d.tendencia_optout?.quantidade_7d ?? 0}</strong> — {d.tendencia_optout?.nivel ?? 'normal'}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Lista clientes prioritários */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/20 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Clientes Prioritários para Contato Hoje</h3>
            <p className="text-[11px] text-muted-foreground">Ordenados por score de prioridade (risco × valor × tempo sem contato)</p>
          </div>
          {d && (
            <span className="text-xs text-muted-foreground">Atualizado: {d.gerado_em?.slice(11, 16)}</span>
          )}
        </div>
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : lista.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  {['#', 'Cliente', 'Valor Vencido', 'Prioridade', 'Etapa', 'Risco', 'Sem contato', ''].map(h => (
                    <th key={h} className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lista.map((c, idx) => (
                  <tr
                    key={c.codcli}
                    className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => navigate(`/lara/clientes/${c.codcli}`)}
                  >
                    <td className="py-2.5 px-3 text-xs font-mono text-muted-foreground">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <p className="text-sm font-medium text-foreground">{c.cliente}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">#{c.codcli}</p>
                    </td>
                    <td className="py-2.5 px-3 text-sm font-semibold">{formatCurrency(c.total_aberto)}</td>
                    <td className="py-2.5 px-3 w-36">
                      <ScoreBar score={c.prioridade_score} max={maxScore} />
                    </td>
                    <td className="py-2.5 px-3"><EtapaReguaBadge etapa={c.etapa_regua} /></td>
                    <td className="py-2.5 px-3"><RiskBadge risk={c.risco as 'baixo' | 'medio' | 'alto' | 'critico'} /></td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">
                      {c.dias_sem_contato >= 99 ? 'Nunca' : `${c.dias_sem_contato}d`}
                    </td>
                    <td className="py-2.5 px-3">
                      <button
                        className="text-[11px] text-primary hover:underline"
                        onClick={(e) => { e.stopPropagation(); navigate(`/lara/titulos?codcli=${c.codcli}`); }}
                      >
                        Ver títulos
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6">
            <EmptyState title="Nenhum cliente prioritário" description="Não há clientes identificados para contato no momento." />
          </div>
        )}
      </div>
    </LaraLayout>
  );
}
