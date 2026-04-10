import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { FilterBar } from '@/components/lara/FilterBar';
import { StatusBadge } from '@/components/lara/StatusBadge';
import { EtapaReguaBadge } from '@/components/lara/EtapaReguaBadge';
import { EmptyState } from '@/components/lara/EmptyState';
import { CardKPI } from '@/components/lara/CardKPI';
import { formatCurrency } from '@/data/lara-mock';
import { MessageSquare, Phone, Clock, FileText, Banknote, User, Eye, CheckCircle, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNavigate } from 'react-router-dom';
import { getClientes, getConversas, getTitulos } from '@/services/laraApi';
import { useLaraFiliaisFilter } from '@/contexts/LaraFiliaisContext';

export default function LaraConversas() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroOrigem, setFiltroOrigem] = useState('todos');
  const { filiaisApiParam, selectedFiliaisKey } = useLaraFiliaisFilter();

  const navigate = useNavigate();

  const { data: conversasData } = useQuery({
    queryKey: ['lara-conversas', selectedFiliaisKey],
    queryFn: () => getConversas({ filiais: filiaisApiParam }),
    staleTime: 30_000,
  });

  const { data: clientesData } = useQuery({
    queryKey: ['lara-clientes', selectedFiliaisKey],
    queryFn: () => getClientes({ filiais: filiaisApiParam }),
    staleTime: 60_000,
  });

  const { data: titulosData } = useQuery({
    queryKey: ['lara-titulos', selectedFiliaisKey],
    queryFn: () => getTitulos({ filiais: filiaisApiParam }),
    staleTime: 60_000,
  });

  const conversas = conversasData ?? [];
  const clientes = clientesData ?? [];
  const titulos = titulosData ?? [];

  useEffect(() => {
    if (!selected && conversas[0]?.id) setSelected(conversas[0].id);
  }, [selected, conversas]);

  const filtered = conversas.filter(c => {
    const matchSearch = !search ||
      c.cliente.toLowerCase().includes(search.toLowerCase()) ||
      c.telefone.includes(search) ||
      c.codcli.includes(search) ||
      c.wa_id.includes(search);
    const matchStatus = filtroStatus === 'todos' || c.status === filtroStatus;
    const matchOrigem = filtroOrigem === 'todos' || c.origem === filtroOrigem;
    return matchSearch && matchStatus && matchOrigem;
  });

  const current = conversas.find(c => c.id === selected);
  const currentCliente = current ? clientes.find(cl => cl.codcli === current.codcli) : undefined;
  const currentTitulos = current ? titulos.filter(t => t.codcli === current.codcli) : [];

  const totalConversas = conversas.length;
  const conversasAtivas = conversas.filter(c => !c.encerrada).length;
  const aguardandoResposta = conversas.filter(c => c.status === 'Aguardando resposta').length;
  const escaladas = conversas.filter(c => c.status === 'Escalado para humano').length;

  const statusList = [...new Set(conversas.map(c => c.status))];
  const origemList = [...new Set(conversas.map(c => c.origem))];

  return (
    <LaraLayout>
      <PageHeader title="Conversas" subtitle="Acompanhamento e historico de conversas via WhatsApp" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <CardKPI label="Total de Conversas" value={totalConversas} icon={<MessageSquare className="h-4 w-4" />} />
        <CardKPI label="Conversas Ativas" value={conversasAtivas} icon={<Phone className="h-4 w-4" />} />
        <CardKPI label="Aguardando Resposta" value={aguardandoResposta} icon={<Clock className="h-4 w-4" />} />
        <CardKPI label="Escaladas p/ Humano" value={escaladas} icon={<AlertTriangle className="h-4 w-4" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-4 h-[calc(100vh-280px)]">
        <div className="flex flex-col border rounded-lg bg-card overflow-hidden">
          <div className="p-3 border-b space-y-2">
            <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Buscar cliente, telefone, codcli, wa_id..." />
            <div className="flex gap-2 flex-wrap">
              <select
                value={filtroStatus}
                onChange={e => setFiltroStatus(e.target.value)}
                className="text-xs border rounded px-2 py-1 bg-background text-foreground"
              >
                <option value="todos">Todos os status</option>
                {statusList.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                value={filtroOrigem}
                onChange={e => setFiltroOrigem(e.target.value)}
                className="text-xs border rounded px-2 py-1 bg-background text-foreground"
              >
                <option value="todos">Todas as origens</option>
                {origemList.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <ScrollArea className="flex-1">
            {filtered.length === 0 ? (
              <EmptyState title="Nenhuma conversa" description="Nenhuma conversa encontrada com os filtros aplicados." />
            ) : (
              <div className="divide-y">
                {filtered.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c.id)}
                    className={`w-full text-left p-3 hover:bg-muted/50 transition-colors ${selected === c.id ? 'bg-accent/60 border-l-2 border-l-primary' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{c.cliente}</p>
                        <p className="text-[11px] text-muted-foreground">{c.telefone} · {c.wa_id}</p>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 truncate">
                      {c.mensagens[c.mensagens.length - 1]?.texto}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <EtapaReguaBadge etapa={c.etapa} />
                      <span className="text-[10px] text-muted-foreground">{c.origem}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">{c.total_mensagens} msgs</span>
                      {c.encerrada && <Badge variant="secondary" className="text-[9px]">Encerrada</Badge>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="border rounded-lg bg-card overflow-hidden flex flex-col">
          {!current ? (
            <EmptyState title="Selecione uma conversa" description="Clique em uma conversa na lista para visualizar o historico." />
          ) : (
            <>
              <div className="p-4 border-b bg-muted/20">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-base font-bold text-foreground">{current.cliente}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {current.telefone} · wa_id: {current.wa_id} · codcli: {current.codcli}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <StatusBadge status={current.status} />
                      <EtapaReguaBadge etapa={current.etapa} />
                      <Badge variant="outline" className="text-[10px]">{current.origem}</Badge>
                      <span className="text-[10px] text-muted-foreground">Responsavel: {current.responsavel}</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" className="text-xs" onClick={() => navigate(`/lara/clientes/${current.codcli}`)}>
                      <Eye className="h-3 w-3 mr-1" />Cliente 360
                    </Button>
                  </div>
                </div>
                {currentCliente && (
                  <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                    <span>Total em aberto: <strong className="text-foreground">{formatCurrency(currentCliente.total_aberto)}</strong></span>
                    <span>Titulos: <strong className="text-foreground">{currentCliente.qtd_titulos}</strong></span>
                    <span>Risco: <strong className="text-foreground capitalize">{currentCliente.risco}</strong></span>
                  </div>
                )}
              </div>

              <ScrollArea className="flex-1 p-4">
                <div className="space-y-3 max-w-2xl mx-auto">
                  <div className="flex justify-center">
                    <Badge variant="secondary" className="text-[10px]">
                      Inicio da conversa · {current.inicio}
                    </Badge>
                  </div>

                  {current.mensagens.map(msg => (
                    <div key={msg.id} className={`flex ${msg.remetente === 'cliente' ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[75%] rounded-lg p-3 ${
                        msg.tipo === 'sistema'
                          ? 'bg-muted/40 text-center mx-auto text-xs text-muted-foreground italic'
                          : msg.remetente === 'cliente'
                            ? 'bg-muted/60 rounded-bl-none'
                            : 'bg-primary/10 border border-primary/20 rounded-br-none'
                      }`}>
                        {msg.tipo !== 'sistema' && (
                          <div className="flex items-center gap-1.5 mb-1">
                            {msg.remetente === 'cliente' ? (
                              <User className="h-3 w-3 text-muted-foreground" />
                            ) : (
                              <MessageSquare className="h-3 w-3 text-primary" />
                            )}
                            <span className="text-[10px] font-medium text-muted-foreground">
                              {msg.remetente === 'cliente' ? current.cliente.split(' ')[0] : 'Lara'}
                            </span>
                            {msg.tipo === 'boleto' && <FileText className="h-3 w-3 text-emerald-600" />}
                            {msg.tipo === 'pix' && <Banknote className="h-3 w-3 text-violet-600" />}
                          </div>
                        )}
                        <p className={`text-sm ${msg.tipo === 'sistema' ? '' : 'text-foreground'}`}>{msg.texto}</p>
                        {msg.tipo !== 'sistema' && (
                          <p className="text-[10px] text-muted-foreground mt-1 text-right">{msg.data_hora.split(' ')[1]}</p>
                        )}
                      </div>
                    </div>
                  ))}

                  {current.encerrada && (
                    <div className="flex justify-center mt-2">
                      <Badge variant="secondary" className="text-[10px]">
                        <CheckCircle className="h-3 w-3 mr-1" />Conversa encerrada · {current.ultima_interacao}
                      </Badge>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {currentTitulos.length > 0 && (
                <div className="border-t p-3 bg-muted/10">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Titulos Relacionados</p>
                  <div className="flex gap-2 overflow-x-auto">
                    {currentTitulos.map(t => (
                      <div key={t.id} className="shrink-0 rounded border bg-card px-3 py-2 text-xs">
                        <span className="font-mono text-[11px]">{t.duplicata}</span>
                        <span className="text-muted-foreground ml-2">{formatCurrency(t.valor)}</span>
                        <span className="text-muted-foreground ml-2">{t.dias_atraso > 0 ? `${t.dias_atraso}d atraso` : 'Em dia'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </LaraLayout>
  );
}

