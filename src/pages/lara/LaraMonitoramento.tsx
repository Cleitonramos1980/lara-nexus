import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { CardKPI } from '@/components/lara/CardKPI';
import { HealthIndicator } from '@/components/lara/HealthIndicator';
import { AlertCard } from '@/components/lara/AlertCard';
import { SeverityBadge } from '@/components/lara/SeverityBadge';
import { Button } from '@/components/ui/button';
import { MessageSquare, AlertTriangle, XCircle, Clock, Brain, Bot } from 'lucide-react';
import {
  getLogs,
  getMonitoramentoHealth,
  getMonitoramentoResumo,
  getSincronizacaoUltima,
  updateJanelaSincronizacao,
} from '@/services/laraApi';
import { useLaraFiliaisFilter } from '@/contexts/LaraFiliaisContext';

function formatPercent(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  const normalized = safeValue <= 1 ? safeValue * 100 : safeValue;
  return `${normalized.toFixed(1)}%`;
}

export default function LaraMonitoramento() {
  const queryClient = useQueryClient();
  const { filiaisApiParam, selectedFiliaisKey } = useLaraFiliaisFilter();
  const { data: healthData } = useQuery({
    queryKey: ['lara-monitoramento-health'],
    queryFn: getMonitoramentoHealth,
    staleTime: 15_000,
  });

  const { data: resumoData } = useQuery({
    queryKey: ['lara-monitoramento-resumo'],
    queryFn: getMonitoramentoResumo,
    staleTime: 15_000,
  });

  const { data: logsData } = useQuery({
    queryKey: ['lara-logs', selectedFiliaisKey],
    queryFn: () => getLogs({ filiais: filiaisApiParam, limit: 500 }),
    staleTime: 15_000,
  });
  const { data: syncData } = useQuery({
    queryKey: ['lara-sync-ultima'],
    queryFn: getSincronizacaoUltima,
    staleTime: 15_000,
  });

  const toggleSyncMutation = useMutation({
    mutationFn: async (ativo: boolean) => updateJanelaSincronizacao({ ativo }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lara-sync-ultima'] });
      await queryClient.invalidateQueries({ queryKey: ['lara-monitoramento-resumo'] });
    },
  });

  const componentes = healthData?.componentes ?? [];
  const resumo = resumoData ?? {
    mensagens_enviadas: 0,
    mensagens_recebidas: 0,
    promessas_registradas: 0,
    optouts_ativos: 0,
    casos_escalados: 0,
    sincronizacao_diaria_ok_hoje: 0,
    falhas_sincronizacao_hoje: 0,
    fila_pendente: 0,
    erros_integracao: 0,
    clientes_risco_critico: 0,
    valor_total_aberto: 0,
    classificador_total_classificacoes: 0,
    classificador_openai_usado: 0,
    classificador_fallback_local: 0,
    classificador_circuito_aberto_eventos: 0,
    classificador_acuracia_estimada_media: 0,
    classificador_por_intent: [],
  };
  const logs = logsData ?? [];
  const syncConfig = syncData?.configuracao;
  const syncLast = syncData?.ultima_execucao;
  const classificadorIntents = resumo.classificador_por_intent ?? [];
  const totalClassificacoes = resumo.classificador_total_classificacoes ?? 0;
  const openaiUsado = resumo.classificador_openai_usado ?? 0;
  const fallbackLocal = resumo.classificador_fallback_local ?? 0;
  const taxaOpenAi = totalClassificacoes > 0 ? (openaiUsado / totalClassificacoes) * 100 : 0;
  const taxaFallback = totalClassificacoes > 0 ? (fallbackLocal / totalClassificacoes) * 100 : 0;

  const alertas = logs.filter(l => l.severidade === 'erro' || l.severidade === 'aviso').slice(0, 3);

  return (
    <LaraLayout>
      <PageHeader title="Monitoramento" subtitle="Torre de controle operacional da Lara" />

      <div className="mb-6">
        <h3 className="text-sm font-semibold text-foreground mb-3">Saude dos Componentes</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {componentes.map(c => (
            <HealthIndicator key={c.label} label={c.label} status={c.status as any} detail={c.detail} />
          ))}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        <CardKPI label="Atendimentos Hoje" value={resumo.mensagens_recebidas ?? 0} icon={<MessageSquare className="h-4 w-4" />} />
        <CardKPI label="Fila Pendente" value={resumo.fila_pendente ?? 0} icon={<Clock className="h-4 w-4" />} />
        <CardKPI label="Erros Integracao" value={resumo.erros_integracao ?? 0} icon={<XCircle className="h-4 w-4" />} />
        <CardKPI label="Clientes Criticos" value={resumo.clientes_risco_critico ?? 0} icon={<AlertTriangle className="h-4 w-4" />} />
        <CardKPI label="Classificacoes IA" value={totalClassificacoes} icon={<Brain className="h-4 w-4" />} />
        <CardKPI label="Taxa OpenAI" value={`${taxaOpenAi.toFixed(1)}%`} icon={<Bot className="h-4 w-4" />} />
        <CardKPI label="Fallback Local" value={`${taxaFallback.toFixed(1)}%`} icon={<AlertTriangle className="h-4 w-4" />} />
        <CardKPI label="Acuracia Estimada IA" value={formatPercent(resumo.classificador_acuracia_estimada_media ?? 0)} icon={<Brain className="h-4 w-4" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Eventos Criticos Recentes</h3>
          <div className="space-y-3">
            {alertas.length === 0 ? (
              <AlertCard type="info" title="Sem alertas criticos" description="Nao ha eventos criticos recentes." />
            ) : (
              alertas.map(item => (
                <AlertCard
                  key={item.id}
                  type={item.severidade === 'erro' ? 'error' : 'warning'}
                  title={item.tipo}
                  description={item.mensagem}
                />
              ))
            )}
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Resumo Operacional do Dia</h3>
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <div className="flex justify-between items-center"><span className="text-sm text-foreground">Mensagens enviadas</span><span className="text-sm font-bold text-foreground">{resumo.mensagens_enviadas ?? 0}</span></div>
            <div className="flex justify-between items-center"><span className="text-sm text-foreground">Mensagens recebidas</span><span className="text-sm font-bold text-foreground">{resumo.mensagens_recebidas ?? 0}</span></div>
            <div className="flex justify-between items-center"><span className="text-sm text-foreground">Promessas registradas</span><span className="text-sm font-bold text-foreground">{resumo.promessas_registradas ?? 0}</span></div>
            <div className="flex justify-between items-center"><span className="text-sm text-foreground">Opt-outs ativos</span><span className="text-sm font-bold text-foreground">{resumo.optouts_ativos ?? 0}</span></div>
            <div className="flex justify-between items-center"><span className="text-sm text-foreground">Casos escalados</span><span className="text-sm font-bold text-foreground">{resumo.casos_escalados ?? 0}</span></div>
            <div className="flex justify-between items-center"><span className="text-sm text-foreground">Sincronizacao PCPREST hoje</span><span className="text-sm font-bold text-foreground">{(resumo.sincronizacao_diaria_ok_hoje ?? 0) === 1 ? 'OK' : 'Pendente'}</span></div>
            <div className="flex justify-between items-center"><span className="text-sm text-foreground">Falhas sync hoje</span><span className="text-sm font-bold text-foreground">{resumo.falhas_sincronizacao_hoje ?? 0}</span></div>
            <div className="flex justify-between items-center"><span className="text-sm text-foreground">Classificacoes IA</span><span className="text-sm font-bold text-foreground">{totalClassificacoes}</span></div>
            <div className="flex justify-between items-center"><span className="text-sm text-foreground">OpenAI usado</span><span className="text-sm font-bold text-foreground">{openaiUsado}</span></div>
            <div className="flex justify-between items-center"><span className="text-sm text-foreground">Fallback local</span><span className="text-sm font-bold text-foreground">{fallbackLocal}</span></div>
            <div className="flex justify-between items-center"><span className="text-sm text-foreground">Circuito aberto (eventos)</span><span className="text-sm font-bold text-foreground">{resumo.classificador_circuito_aberto_eventos ?? 0}</span></div>
            <div className="flex justify-between items-center"><span className="text-sm text-foreground">Janela sync diaria</span><span className="text-sm font-bold text-foreground">{syncConfig?.ativo ? `Ativa ${String(syncConfig.hora).padStart(2, '0')}:${String(syncConfig.minuto).padStart(2, '0')}` : 'Desativada'}</span></div>
            <div className="flex justify-between items-center"><span className="text-sm text-foreground">Ultima sync</span><span className="text-sm font-bold text-foreground">{syncLast?.data_hora ?? '-'}</span></div>
            <div className="flex justify-between items-center"><span className="text-sm text-foreground">Valor total em aberto</span><span className="text-sm font-bold text-foreground">R$ {(resumo.valor_total_aberto ?? 0).toLocaleString('pt-BR')}</span></div>
            <div className="pt-2">
              {syncConfig?.ativo ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={toggleSyncMutation.isPending}
                  onClick={() => toggleSyncMutation.mutate(false)}
                >
                  Desativar Janela Sync
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={toggleSyncMutation.isPending}
                  onClick={() => toggleSyncMutation.mutate(true)}
                >
                  Ativar Janela Sync
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Classificador IA por Intent</h3>
              <span className="text-xs text-muted-foreground">{classificadorIntents.length} intents</span>
            </div>
            {classificadorIntents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados de classificacao para o periodo atual.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Intent</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Total</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">OpenAI</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Fallback</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Acuracia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classificadorIntents.map((item) => (
                      <tr key={item.intent} className="border-b last:border-0">
                        <td className="px-3 py-2 text-sm font-medium text-foreground">{item.intent}</td>
                        <td className="px-3 py-2 text-sm text-foreground">{item.total}</td>
                        <td className="px-3 py-2 text-sm text-foreground">{item.openai}</td>
                        <td className="px-3 py-2 text-sm text-foreground">{item.fallback}</td>
                        <td className="px-3 py-2 text-sm text-foreground">{formatPercent(item.acuracia_media)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-lg border bg-card overflow-hidden">
        <div className="p-4 border-b">
          <h3 className="text-sm font-semibold text-foreground">Ultimos Eventos</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                {['Hora', 'Severidade', 'Tipo', 'Mensagem'].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, 5).map(l => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="py-2 px-3 text-xs">{l.data_hora}</td>
                  <td className="py-2 px-3"><SeverityBadge severity={l.severidade} /></td>
                  <td className="py-2 px-3 text-xs font-medium">{l.tipo}</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{l.mensagem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </LaraLayout>
  );
}

