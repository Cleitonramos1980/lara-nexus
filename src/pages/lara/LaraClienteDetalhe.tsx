import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { StatusBadge } from '@/components/lara/StatusBadge';
import { RiskBadge } from '@/components/lara/RiskBadge';
import { EtapaReguaBadge } from '@/components/lara/EtapaReguaBadge';
import { EmptyState } from '@/components/lara/EmptyState';
import { maskCpfCnpj, formatCurrency } from '@/data/lara-mock';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, ShieldBan } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getCliente, getClienteCases, getClienteConversas, getClienteTitulos } from '@/services/laraApi';

export default function LaraClienteDetalhe() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: cliente } = useQuery({
    queryKey: ['lara-cliente', id],
    queryFn: () => getCliente(id || ''),
    enabled: Boolean(id),
  });

  const { data: titulosData } = useQuery({
    queryKey: ['lara-cliente-titulos', id],
    queryFn: () => getClienteTitulos(id || ''),
    enabled: Boolean(id),
  });

  const { data: casesData } = useQuery({
    queryKey: ['lara-cliente-cases', id],
    queryFn: () => getClienteCases(id || ''),
    enabled: Boolean(id),
  });

  const { data: conversasData } = useQuery({
    queryKey: ['lara-cliente-conversas', id],
    queryFn: () => getClienteConversas(id || ''),
    enabled: Boolean(id),
  });

  if (!cliente) {
    return (
      <LaraLayout>
        <EmptyState title="Cliente nao encontrado" description="O cliente solicitado nao foi localizado." />
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
          <div className="flex gap-2">
            <RiskBadge risk={cliente.risco} />
            <StatusBadge status={cliente.status} />
            {cliente.optout && <Badge variant="destructive" className="text-xs"><ShieldBan className="h-3 w-3 mr-1" />Opt-out Ativo</Badge>}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
        {[
          { label: 'Telefone', value: cliente.telefone },
          { label: 'wa_id', value: cliente.wa_id },
          { label: 'CPF/CNPJ', value: maskCpfCnpj(cliente.cpf_cnpj) },
          { label: 'Total em Aberto', value: formatCurrency(cliente.total_aberto) },
          { label: 'Qtd. Titulos', value: String(cliente.qtd_titulos) },
          { label: 'Titulo Mais Antigo', value: cliente.titulo_mais_antigo },
          { label: 'Prox. Vencimento', value: cliente.proximo_vencimento },
          { label: 'Ultimo Contato', value: cliente.ultimo_contato },
          { label: 'Ultima Acao', value: cliente.ultima_acao },
          { label: 'Proxima Acao', value: cliente.proxima_acao },
          { label: 'Responsavel', value: cliente.responsavel },
          { label: 'Etapa Regua', value: cliente.etapa_regua },
        ].map(item => (
          <div key={item.label} className="rounded-lg border bg-card p-3">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{item.label}</span>
            <p className="text-sm font-medium text-foreground mt-0.5">{item.value || '—'}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="titulos" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="titulos">Titulos ({titulos.length})</TabsTrigger>
          <TabsTrigger value="cases">Cases ({cases.length})</TabsTrigger>
          <TabsTrigger value="conversas">Conversas ({conversas.length})</TabsTrigger>
          <TabsTrigger value="regua">Regua Ativa</TabsTrigger>
        </TabsList>

        <TabsContent value="titulos">
          {titulos.length === 0 ? (
            <EmptyState title="Sem titulos" description="Nenhum titulo encontrado para este cliente." />
          ) : (
            <div className="rounded-lg border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['Duplicata', 'Prestacao', 'Valor', 'Vencimento', 'Atraso', 'Etapa', 'Status', 'Boleto'].map(h => (
                      <th key={h} className="text-left py-3 px-3 text-xs font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {titulos.map(t => (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="py-2 px-3 font-mono text-xs">{t.duplicata}</td>
                      <td className="py-2 px-3 text-xs">{t.prestacao}</td>
                      <td className="py-2 px-3 font-medium">{formatCurrency(t.valor)}</td>
                      <td className="py-2 px-3 text-xs">{t.vencimento}</td>
                      <td className="py-2 px-3 text-xs">{t.dias_atraso > 0 ? `${t.dias_atraso}d` : 'Em dia'}</td>
                      <td className="py-2 px-3"><EtapaReguaBadge etapa={t.etapa_regua} /></td>
                      <td className="py-2 px-3"><StatusBadge status={t.status_atendimento} /></td>
                      <td className="py-2 px-3">
                        <Badge variant={t.boleto_disponivel ? 'default' : 'secondary'} className="text-[10px]">
                          {t.boleto_disponivel ? 'Sim' : 'Nao'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="cases">
          {cases.length === 0 ? (
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
          {conversas.length === 0 ? (
            <EmptyState title="Sem conversas" description="Nao existem conversas registradas para este cliente." />
          ) : (
            <div className="space-y-3">
              {conversas.map(conv => (
                <div key={conv.id} className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">{conv.status}</p>
                    <span className="text-[10px] text-muted-foreground">{conv.ultima_interacao}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{conv.total_mensagens} mensagens · {conv.origem}</p>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="regua">
          <EmptyState title="Regua ativa" description="Historico detalhado da regua sera exibido nesta aba." />
        </TabsContent>
      </Tabs>
    </LaraLayout>
  );
}

