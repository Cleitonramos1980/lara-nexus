import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { StatusBadge } from '@/components/lara/StatusBadge';
import { RiskBadge } from '@/components/lara/RiskBadge';
import { EtapaReguaBadge } from '@/components/lara/EtapaReguaBadge';
import { EmptyState } from '@/components/lara/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { maskCpfCnpj, formatCurrency } from '@/data/lara-mock';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, ShieldBan, Zap, MessageSquare, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getCliente, getClienteCases, getClienteConversas, getClienteTitulos, getPropensityScore } from '@/services/laraApi';

function ScoreMeter({ score, level }: { score: number; level: string }) {
  const color =
    level === 'alto' ? 'bg-emerald-500' :
    level === 'medio' ? 'bg-amber-500' :
    'bg-red-500';
  const labelColor =
    level === 'alto' ? 'text-emerald-600' :
    level === 'medio' ? 'text-amber-600' :
    'text-red-600';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Score de Propensão</span>
        <span className={`text-sm font-bold ${labelColor}`}>{score}/100</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <p className={`text-[10px] font-medium capitalize ${labelColor}`}>{level}</p>
    </div>
  );
}

export default function LaraClienteDetalhe() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: cliente, isLoading: loadingCliente } = useQuery({
    queryKey: ['lara-cliente', id],
    queryFn: () => getCliente(id || ''),
    enabled: Boolean(id),
  });

  const { data: titulosData, isLoading: loadingTitulos } = useQuery({
    queryKey: ['lara-cliente-titulos', id],
    queryFn: () => getClienteTitulos(id || ''),
    enabled: Boolean(id),
  });

  const { data: casesData, isLoading: loadingCases } = useQuery({
    queryKey: ['lara-cliente-cases', id],
    queryFn: () => getClienteCases(id || ''),
    enabled: Boolean(id),
  });

  const { data: conversasData, isLoading: loadingConversas } = useQuery({
    queryKey: ['lara-cliente-conversas', id],
    queryFn: () => getClienteConversas(id || ''),
    enabled: Boolean(id),
  });

  const { data: propensity, isLoading: loadingPropensity } = useQuery({
    queryKey: ['lara-cliente-propensity', id],
    queryFn: () => getPropensityScore(id || ''),
    enabled: Boolean(id),
    staleTime: 300_000,
  });

  if (loadingCliente) {
    return (
      <LaraLayout>
        <div className="mb-4">
          <Skeleton className="h-8 w-40" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-12 w-2/3" />
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
          </div>
        </div>
      </LaraLayout>
    );
  }

  if (!cliente) {
    return (
      <LaraLayout>
        <EmptyState title="Cliente não encontrado" description="O cliente solicitado não foi localizado." />
      </LaraLayout>
    );
  }

  const titulos = titulosData ?? [];
  const cases = casesData ?? [];
  const conversas = conversasData ?? [];

  return (
    <LaraLayout>
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/lara/clientes')} className="text-xs">
          <ArrowLeft className="h-3 w-3 mr-1" /> Voltar para Clientes
        </Button>
      </div>

      <PageHeader
        title={cliente.cliente}
        subtitle={`codcli: ${cliente.codcli} · ${cliente.filial}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <RiskBadge risk={cliente.risco} />
            <StatusBadge status={cliente.status} />
            {cliente.optout && (
              <Badge variant="destructive" className="text-xs">
                <ShieldBan className="h-3 w-3 mr-1" />Opt-out Ativo
              </Badge>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {[
            { label: 'Telefone', value: cliente.telefone },
            { label: 'wa_id', value: cliente.wa_id },
            { label: 'CPF/CNPJ', value: maskCpfCnpj(cliente.cpf_cnpj) },
            { label: 'Total em Aberto', value: formatCurrency(cliente.total_aberto) },
            { label: 'Qtd. Títulos', value: String(cliente.qtd_titulos) },
            { label: 'Título Mais Antigo', value: cliente.titulo_mais_antigo },
            { label: 'Próx. Vencimento', value: cliente.proximo_vencimento },
            { label: 'Último Contato', value: cliente.ultimo_contato },
            { label: 'Última Ação', value: cliente.ultima_acao },
            { label: 'Próxima Ação', value: cliente.proxima_acao },
            { label: 'Responsável', value: cliente.responsavel },
            { label: 'Etapa Régua', value: cliente.etapa_regua },
          ].map(item => (
            <div key={item.label} className="rounded-lg border bg-card p-3">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{item.label}</span>
              <p className="text-sm font-medium text-foreground mt-0.5">{item.value || '—'}</p>
            </div>
          ))}
        </div>

        <div className="rounded-lg border bg-card p-4 flex flex-col gap-4">
          {loadingPropensity ? (
            <div className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          ) : propensity ? (
            <>
              <ScoreMeter score={propensity.score} level={propensity.level} />
              <div className="space-y-2 border-t pt-3">
                <div className="flex items-center gap-2 text-xs">
                  <MessageSquare className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                  <span className="text-muted-foreground">Melhor canal:</span>
                  <Badge variant="outline" className="text-[10px]">{propensity.melhor_canal}</Badge>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span className="text-muted-foreground">Melhor hora:</span>
                  <span className="font-mono font-medium">{propensity.melhor_hora}h</span>
                </div>
                <div className="flex items-start gap-2 text-xs pt-1 border-t">
                  <Zap className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  <span className="text-foreground leading-snug">{propensity.recomendacao}</span>
                </div>
              </div>
              {propensity.fatores?.length > 0 && (
                <div className="space-y-1 border-t pt-3">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Fatores</span>
                  <div className="flex flex-wrap gap-1">
                    {propensity.fatores.map((f) => (
                      <Badge key={f} variant="secondary" className="text-[10px]">{f}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-muted-foreground text-center py-4">
              Score de propensão não disponível
            </div>
          )}
        </div>
      </div>

      <Tabs defaultValue="titulos" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="titulos">Títulos ({titulos.length})</TabsTrigger>
          <TabsTrigger value="cases">Cases ({cases.length})</TabsTrigger>
          <TabsTrigger value="conversas">Conversas ({conversas.length})</TabsTrigger>
          <TabsTrigger value="regua">Régua Ativa</TabsTrigger>
        </TabsList>

        <TabsContent value="titulos">
          {loadingTitulos ? (
            <div className="rounded-lg border bg-card p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : titulos.length === 0 ? (
            <EmptyState title="Sem títulos" description="Nenhum título encontrado para este cliente." />
          ) : (
            <div className="rounded-lg border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['Duplicata / NF', 'Transação', 'Emissão', 'Vencimento', 'A Receber', 'Desconto', 'Multa Prev.', 'Atraso', 'Cobrança', 'RCA', 'Etapa', 'Status'].map(h => (
                      <th key={h} className="text-left py-3 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {titulos.map(t => (
                    <tr key={t.id} className={`border-b last:border-0 hover:bg-muted/20 ${t.titulo_com_data_prevista ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}`}>
                      <td className="py-2 px-3 text-xs">
                        <div className="font-mono font-semibold">{t.duplicata}<span className="text-muted-foreground font-normal">/{t.prestacao}</span></div>
                        {t.numnota > 0 && <div className="text-[10px] text-muted-foreground">NF {t.numnota}</div>}
                      </td>
                      <td className="py-2 px-3 font-mono text-xs">
                        {t.numtransvenda > 0
                          ? <span className="text-primary font-semibold">{t.numtransvenda}</span>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{t.dtemissao || '—'}</td>
                      <td className="py-2 px-3 text-xs">
                        <div>{t.vencimento}</div>
                        {t.titulo_com_data_prevista && t.dtrecebimento_previsto && (
                          <div className="text-[10px] text-amber-600">Prev: {t.dtrecebimento_previsto}</div>
                        )}
                      </td>
                      <td className="py-2 px-3 font-semibold text-sm">{formatCurrency(t.vlreceber)}</td>
                      <td className="py-2 px-3 text-xs">
                        {t.vldesc > 0
                          ? <span className="text-emerald-600">-{formatCurrency(t.vldesc)}</span>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </td>
                      <td className="py-2 px-3 text-xs">
                        {t.cmulta_prev > 0
                          ? <span className="text-red-600 font-medium">{formatCurrency(t.cmulta_prev)}</span>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </td>
                      <td className="py-2 px-3 text-xs">
                        {t.dias_atraso > 0
                          ? <span className={t.dias_atraso > 30 ? 'text-red-600 font-semibold' : 'text-amber-600'}>{t.dias_atraso}d</span>
                          : <span className="text-emerald-600">Em dia</span>
                        }
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{t.cobranca || t.codcob}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground truncate max-w-[100px]">{t.rca || '—'}</td>
                      <td className="py-2 px-3"><EtapaReguaBadge etapa={t.etapa_regua} /></td>
                      <td className="py-2 px-3"><StatusBadge status={t.status_atendimento} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="cases">
          {loadingCases ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
            </div>
          ) : cases.length === 0 ? (
            <EmptyState title="Sem cases" description="Nenhum case registrado para este cliente." />
          ) : (
            <div className="space-y-3">
              {cases.map(c => (
                <div key={c.id} className="rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <Badge variant="outline" className="text-xs font-mono">{c.acao}</Badge>
                      <p className="text-sm font-medium text-foreground mt-1">{c.detalhe}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{c.data_hora}</span>
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                    <span>Valor: {formatCurrency(c.valor_total)}</span>
                    <span>Pagamento: {c.forma_pagamento}</span>
                    <span>Origem: {c.origem}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="conversas">
          {loadingConversas ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
            </div>
          ) : conversas.length === 0 ? (
            <EmptyState title="Sem conversas" description="Não existem conversas registradas para este cliente." />
          ) : (
            <div className="space-y-3">
              {conversas.map(conv => (
                <div key={conv.id} className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">{conv.status}</p>
                    <span className="text-[10px] text-muted-foreground">{conv.ultima_interacao}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {conv.total_mensagens} mensagens · {conv.origem}
                  </p>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="regua">
          <EmptyState title="Régua ativa" description="Histórico detalhado da régua será exibido nesta aba." />
        </TabsContent>
      </Tabs>
    </LaraLayout>
  );
}
