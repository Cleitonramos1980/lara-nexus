import { useState } from 'react';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { FilterBar } from '@/components/lara/FilterBar';
import { StatusBadge } from '@/components/lara/StatusBadge';
import { EtapaReguaBadge } from '@/components/lara/EtapaReguaBadge';
import { EmptyState } from '@/components/lara/EmptyState';
import { mockAtendimentos, mockClientes, mockTitulos, formatCurrency } from '@/data/lara-mock';
import { MessageSquare, FileText, Handshake, ShieldBan, Send, UserCog, Eye, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function LaraAtendimentos() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(mockAtendimentos[0]?.id || '');

  const filtered = mockAtendimentos.filter(a =>
    !search || a.cliente.toLowerCase().includes(search.toLowerCase()) ||
    a.telefone.includes(search) || a.codcli.includes(search) || a.wa_id.includes(search)
  );

  const current = mockAtendimentos.find(a => a.id === selected);
  const currentCliente = current ? mockClientes.find(c => c.codcli === current.codcli) : undefined;
  const currentTitulos = current ? mockTitulos.filter(t => t.codcli === current.codcli) : [];

  return (
    <LaraLayout>
      <PageHeader title="Atendimentos" subtitle="Painel operacional de atendimentos via WhatsApp" />

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 h-[calc(100vh-180px)]">
        {/* Painel esquerdo */}
        <div className="flex flex-col border rounded-lg bg-card overflow-hidden">
          <div className="p-3 border-b">
            <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Buscar cliente, telefone, codcli..." />
          </div>
          <ScrollArea className="flex-1">
            {filtered.length === 0 ? (
              <EmptyState title="Nenhum atendimento" description="Nenhum atendimento corresponde à busca." />
            ) : (
              <div className="divide-y">
                {filtered.map(a => (
                  <button
                    key={a.id}
                    onClick={() => setSelected(a.id)}
                    className={`w-full text-left p-3 hover:bg-muted/50 transition-colors ${selected === a.id ? 'bg-accent/60 border-l-2 border-l-primary' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{a.cliente}</p>
                        <p className="text-[11px] text-muted-foreground">{a.telefone}</p>
                      </div>
                      <StatusBadge status={a.status} />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 truncate">{a.ultima_mensagem}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <EtapaReguaBadge etapa={a.etapa} />
                      <span className="text-[10px] text-muted-foreground">{a.origem}</span>
                      <div className="flex gap-1 ml-auto">
                        {a.boleto_enviado && <FileText className="h-3 w-3 text-emerald-600" />}
                        {a.promessa && <Handshake className="h-3 w-3 text-violet-600" />}
                        {a.optout && <ShieldBan className="h-3 w-3 text-red-500" />}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Painel direito */}
        <div className="border rounded-lg bg-card overflow-hidden flex flex-col">
          {!current ? (
            <EmptyState title="Selecione um atendimento" description="Clique em um atendimento na lista ao lado." />
          ) : (
            <ScrollArea className="flex-1">
              <div className="p-5 space-y-5">
                {/* Cabeçalho */}
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{current.cliente}</h2>
                    <p className="text-xs text-muted-foreground">{current.telefone} · wa_id: {current.wa_id} · codcli: {current.codcli}</p>
                  </div>
                  <StatusBadge status={current.status} />
                </div>

                {/* Resumo financeiro */}
                {currentCliente && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-md bg-muted/50 p-3">
                      <span className="text-[10px] text-muted-foreground uppercase">Total em Aberto</span>
                      <p className="text-sm font-bold text-foreground mt-0.5">{formatCurrency(currentCliente.total_aberto)}</p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-3">
                      <span className="text-[10px] text-muted-foreground uppercase">Títulos</span>
                      <p className="text-sm font-bold text-foreground mt-0.5">{currentCliente.qtd_titulos}</p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-3">
                      <span className="text-[10px] text-muted-foreground uppercase">Etapa</span>
                      <div className="mt-1"><EtapaReguaBadge etapa={currentCliente.etapa_regua} /></div>
                    </div>
                    <div className="rounded-md bg-muted/50 p-3">
                      <span className="text-[10px] text-muted-foreground uppercase">Última Ação</span>
                      <p className="text-xs font-medium text-foreground mt-0.5">{currentCliente.ultima_acao}</p>
                    </div>
                  </div>
                )}

                {/* Timeline da conversa */}
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Conversa</h3>
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <MessageSquare className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="rounded-lg bg-muted/50 p-3 flex-1">
                        <div className="flex justify-between">
                          <span className="text-[10px] font-medium text-muted-foreground">Lara Automação</span>
                          <span className="text-[10px] text-muted-foreground">{current.ultima_interacao}</span>
                        </div>
                        <p className="text-sm text-foreground mt-1">{current.ultima_mensagem}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Títulos relacionados */}
                {currentTitulos.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-3">Títulos Relacionados</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 px-2 text-muted-foreground font-medium">Duplicata</th>
                            <th className="text-left py-2 px-2 text-muted-foreground font-medium">Valor</th>
                            <th className="text-left py-2 px-2 text-muted-foreground font-medium">Vencimento</th>
                            <th className="text-left py-2 px-2 text-muted-foreground font-medium">Atraso</th>
                            <th className="text-left py-2 px-2 text-muted-foreground font-medium">Boleto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentTitulos.map(t => (
                            <tr key={t.id} className="border-b last:border-0">
                              <td className="py-2 px-2 font-mono">{t.duplicata} ({t.prestacao})</td>
                              <td className="py-2 px-2 font-medium">{formatCurrency(t.valor)}</td>
                              <td className="py-2 px-2">{t.vencimento}</td>
                              <td className="py-2 px-2">{t.dias_atraso > 0 ? `${t.dias_atraso}d` : 'Em dia'}</td>
                              <td className="py-2 px-2">
                                <Badge variant={t.boleto_disponivel ? 'default' : 'secondary'} className="text-[10px]">
                                  {t.boleto_disponivel ? 'Disponível' : 'Indisponível'}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Ações rápidas */}
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Ações Rápidas</h3>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="text-xs"><RotateCcw className="h-3 w-3 mr-1" />Reenviar Boleto</Button>
                    <Button variant="outline" size="sm" className="text-xs"><Send className="h-3 w-3 mr-1" />Enviar PIX</Button>
                    <Button variant="outline" size="sm" className="text-xs"><Handshake className="h-3 w-3 mr-1" />Registrar Promessa</Button>
                    <Button variant="outline" size="sm" className="text-xs"><UserCog className="h-3 w-3 mr-1" />Escalar p/ Humano</Button>
                    <Button variant="outline" size="sm" className="text-xs"><ShieldBan className="h-3 w-3 mr-1" />Opt-out</Button>
                    <Button variant="outline" size="sm" className="text-xs"><Eye className="h-3 w-3 mr-1" />Cliente 360</Button>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </LaraLayout>
  );
}
