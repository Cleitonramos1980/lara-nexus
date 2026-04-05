import { useParams, useNavigate } from 'react-router-dom';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { StatusBadge } from '@/components/lara/StatusBadge';
import { RiskBadge } from '@/components/lara/RiskBadge';
import { EtapaReguaBadge } from '@/components/lara/EtapaReguaBadge';
import { EmptyState } from '@/components/lara/EmptyState';
import { mockClientes, mockTitulos, mockCases, maskCpfCnpj, formatCurrency } from '@/data/lara-mock';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, ShieldBan } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function LaraClienteDetalhe() {
  const { id } = useParams();
  const navigate = useNavigate();
  const cliente = mockClientes.find(c => c.codcli === id);

  if (!cliente) {
    return (
      <LaraLayout>
        <EmptyState title="Cliente não encontrado" description="O cliente solicitado não foi localizado." />
      </LaraLayout>
    );
  }

  const titulos = mockTitulos.filter(t => t.codcli === cliente.codcli);
  const cases = mockCases.filter(c => c.codcli === cliente.codcli);

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

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
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

      <Tabs defaultValue="titulos" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="titulos">Títulos ({titulos.length})</TabsTrigger>
          <TabsTrigger value="cases">Cases ({cases.length})</TabsTrigger>
          <TabsTrigger value="conversas">Conversas</TabsTrigger>
          <TabsTrigger value="regua">Régua Ativa</TabsTrigger>
        </TabsList>

        <TabsContent value="titulos">
          {titulos.length === 0 ? (
            <EmptyState title="Sem títulos" description="Nenhum título encontrado para este cliente." />
          ) : (
            <div className="rounded-lg border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['Duplicata', 'Prestação', 'Valor', 'Vencimento', 'Atraso', 'Etapa', 'Status', 'Boleto'].map(h => (
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
                          {t.boleto_disponivel ? 'Sim' : 'Não'}
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
          <EmptyState title="Histórico de conversas" description="O histórico completo será exibido após integração com o backend." />
        </TabsContent>

        <TabsContent value="regua">
          <EmptyState title="Régua ativa" description="O histórico de régua ativa será exibido após integração com o backend." />
        </TabsContent>
      </Tabs>
    </LaraLayout>
  );
}
