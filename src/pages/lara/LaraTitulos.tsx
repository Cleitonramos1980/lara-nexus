import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { FilterBar } from '@/components/lara/FilterBar';
import { StatusBadge } from '@/components/lara/StatusBadge';
import { EtapaReguaBadge } from '@/components/lara/EtapaReguaBadge';
import { EmptyState } from '@/components/lara/EmptyState';
import { TableSkeleton } from '@/components/lara/TableSkeleton';
import { formatCurrency } from '@/data/lara-mock';
import { Eye, RotateCcw, Send, X, ExternalLink, FileText, Banknote, CalendarDays, Building2, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { enviarBoleto, enviarPix, getTitulos, recarregarTitulosOracle } from '@/services/laraApi';
import { useLaraFiliaisFilter } from '@/contexts/LaraFiliaisContext';

type Titulo = {
  id: string; duplicata: string; prestacao: string; numtransvenda: number; numnota: number;
  codcli: string; cliente: string; fantasia: string; telefone: string;
  valor: number; vlreceber: number; vldesc: number; cmulta_prev: number; percmulta: number;
  vencimento: string; dtemissao: string; dtrecebimento_previsto: string; dias_atraso: number;
  codcob: string; cobranca: string; rca: string; etapa_regua: string; status_atendimento: string;
  boleto_disponivel: boolean; pix_disponivel: boolean; titulo_com_data_prevista: boolean;
  ultima_acao: string; responsavel: string; filial: string;
};

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function LaraTitulos() {
  const [search, setSearch] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTitulo, setSelectedTitulo] = useState<Titulo | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { filiaisApiParam, selectedFiliaisKey } = useLaraFiliaisFilter();

  const atrasoMin = searchParams.get('atrasoMin') ? Number(searchParams.get('atrasoMin')) : null;
  const atrasoMax = searchParams.get('atrasoMax') ? Number(searchParams.get('atrasoMax')) : null;
  const avencer = searchParams.get('avencer') === '1';
  const vencendoHoje = searchParams.get('vencendoHoje') === '1';
  const codcliParam = searchParams.get('codcli') ?? null;

  function clearFilters() {
    setSearchParams({});
  }

  const hasUrlFilter = atrasoMin !== null || atrasoMax !== null || avencer || vencendoHoje || codcliParam !== null;

  function filterLabel(): string {
    if (codcliParam) return `Cliente #${codcliParam}`;
    if (vencendoHoje) return 'Vencendo Hoje';
    if (avencer) return 'A Vencer';
    if (atrasoMin !== null && atrasoMax !== null) return `Atraso ${atrasoMin}–${atrasoMax} dias`;
    if (atrasoMin !== null) return `Atraso ≥ ${atrasoMin} dias`;
    if (atrasoMax !== null) return `Atraso ≤ ${atrasoMax} dias`;
    return '';
  }

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['lara-titulos', selectedFiliaisKey],
    queryFn: () => getTitulos({ filiais: filiaisApiParam }),
    staleTime: 60_000,
  });

  const refreshMutation = useMutation({
    mutationFn: () => recarregarTitulosOracle({ limit: 30000 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lara-titulos'] });
      queryClient.invalidateQueries({ queryKey: ['lara-clientes'] });
      queryClient.invalidateQueries({ queryKey: ['lara-dashboard'] });
    },
  });

  const boletoMutation = useMutation({
    mutationFn: (payload: { codcli: number; duplicata: string }) =>
      enviarBoleto({ codcli: payload.codcli, duplicatas: [payload.duplicata], origem: 'ui-titulos' }),
  });

  const pixMutation = useMutation({
    mutationFn: (payload: { codcli: number; duplicata: string }) =>
      enviarPix({ codcli: payload.codcli, duplicatas: [payload.duplicata], origem: 'ui-titulos' }),
  });

  const titulos = data ?? [];
  const hoje = getToday();

  const filtered = titulos.filter(t => {
    if (codcliParam && t.codcli !== codcliParam) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!t.cliente.toLowerCase().includes(s) && !t.codcli.includes(s) && !t.duplicata.toLowerCase().includes(s)) return false;
    }
    if (vencendoHoje && t.vencimento !== hoje) return false;
    if (avencer && t.vencimento <= hoje) return false;
    if (atrasoMin !== null && t.dias_atraso < atrasoMin) return false;
    if (atrasoMax !== null && t.dias_atraso > atrasoMax) return false;
    return true;
  });

  return (
    <LaraLayout>
      <PageHeader
        title="Títulos"
        subtitle="Gestão de duplicatas, vencimentos, valores, status e ações de cobrança."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="text-xs"
          >
            {refreshMutation.isPending ? 'Atualizando...' : 'Recarregar Oracle'}
          </Button>
        }
      />
      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar por cliente, codcli, duplicata..."
      />

      {hasUrlFilter && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-xs text-muted-foreground">Filtro ativo:</span>
          <Badge variant="secondary" className="text-xs gap-1">
            {filterLabel()}
          </Badge>
          <span className="text-xs text-muted-foreground">{filtered.length} título{filtered.length !== 1 ? 's' : ''}</span>
          <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-3 w-3" /> Limpar filtro
          </button>
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive mb-4 flex items-center justify-between">
          <span>Falha ao carregar títulos.</span>
          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={10} cols={12} />
      ) : filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  {['Duplicata / NF', 'Transação', 'Codcli', 'Cliente / Fantasia', 'Emissão', 'Vencimento', 'Valor', 'Desconto', 'Multa Prev.', 'Atraso', 'Etapa', 'Status', 'Cobrança', 'RCA', 'Filial', ''].map(h => (
                    <th key={h} className="text-left py-3 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} className={`border-b last:border-0 hover:bg-muted/20 transition-colors ${t.titulo_com_data_prevista ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}`}>
                    <td className="py-2.5 px-2 text-xs">
                      <div className="font-mono font-semibold">{t.duplicata} <span className="text-muted-foreground font-normal">/{t.prestacao}</span></div>
                      {t.numnota > 0 && <div className="text-[10px] text-muted-foreground">NF {t.numnota}</div>}
                    </td>
                    <td className="py-2.5 px-2 font-mono text-xs">
                      {t.numtransvenda > 0
                        ? <span className="text-primary font-semibold">{t.numtransvenda}</span>
                        : <span className="text-muted-foreground">—</span>
                      }
                    </td>
                    <td className="py-2.5 px-2 font-mono text-xs">{t.codcli}</td>
                    <td className="py-2.5 px-2 text-xs max-w-[180px]">
                      <div className="font-medium truncate">{t.cliente}</div>
                      {t.fantasia && t.fantasia !== t.cliente && <div className="text-[10px] text-muted-foreground truncate">{t.fantasia}</div>}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground">{t.dtemissao || '—'}</td>
                    <td className="py-2.5 px-2 text-xs">
                      <div>{t.vencimento}</div>
                      {t.titulo_com_data_prevista && t.dtrecebimento_previsto && (
                        <div className="text-[10px] text-amber-600">Prev: {t.dtrecebimento_previsto}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-xs">
                      <div className="font-semibold">{formatCurrency(t.vlreceber)}</div>
                      {t.vldesc > 0 && <div className="text-[10px] text-muted-foreground">orig: {formatCurrency(t.valor)}</div>}
                    </td>
                    <td className="py-2.5 px-2 text-xs">
                      {t.vldesc > 0
                        ? <span className="text-emerald-600 font-medium">-{formatCurrency(t.vldesc)}</span>
                        : <span className="text-muted-foreground">—</span>
                      }
                    </td>
                    <td className="py-2.5 px-2 text-xs">
                      {t.cmulta_prev > 0
                        ? <span className="text-red-600 font-medium">{formatCurrency(t.cmulta_prev)}</span>
                        : <span className="text-muted-foreground">—</span>
                      }
                    </td>
                    <td className="py-2.5 px-2 text-xs">
                      {t.dias_atraso > 0
                        ? <span className={t.dias_atraso > 30 ? 'text-red-600 font-semibold' : 'text-amber-600'}>{t.dias_atraso}d</span>
                        : <span className="text-emerald-600">Em dia</span>
                      }
                    </td>
                    <td className="py-2.5 px-2"><EtapaReguaBadge etapa={t.etapa_regua} /></td>
                    <td className="py-2.5 px-2"><StatusBadge status={t.status_atendimento} /></td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground">{t.cobranca || t.codcob}</td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground truncate max-w-[100px]">{t.rca || '—'}</td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground">{t.filial}</td>
                    <td className="py-2.5 px-2">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver detalhe" onClick={() => setSelectedTitulo(t as Titulo)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Reenviar boleto"
                          disabled={boletoMutation.isPending}
                          onClick={() => boletoMutation.mutate({ codcli: Number(t.codcli), duplicata: t.duplicata })}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Enviar PIX"
                          disabled={pixMutation.isPending}
                          onClick={() => pixMutation.mutate({ codcli: Number(t.codcli), duplicata: t.duplicata })}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t bg-muted/10 text-xs text-muted-foreground">
            {filtered.length} título{filtered.length !== 1 ? 's' : ''}{search ? ` encontrado${filtered.length !== 1 ? 's' : ''}` : ' no total'}
          </div>
        </div>
      )}
      {/* Drawer de detalhes do título */}
      <Sheet open={!!selectedTitulo} onOpenChange={(open) => { if (!open) setSelectedTitulo(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto" side="right">
          {selectedTitulo && (
            <>
              <SheetHeader className="pr-6">
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <SheetTitle className="text-base">
                      Duplicata <span className="font-mono">{selectedTitulo.duplicata}/{selectedTitulo.prestacao}</span>
                    </SheetTitle>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {selectedTitulo.numnota > 0 && (
                        <span className="text-xs text-muted-foreground">NF {selectedTitulo.numnota}</span>
                      )}
                      {selectedTitulo.numtransvenda > 0 && (
                        <span className="text-xs text-muted-foreground">Transação {selectedTitulo.numtransvenda}</span>
                      )}
                      <EtapaReguaBadge etapa={selectedTitulo.etapa_regua} />
                      <StatusBadge status={selectedTitulo.status_atendimento} />
                    </div>
                  </div>
                </div>
              </SheetHeader>

              <div className="mt-5 space-y-5">
                {/* Cliente */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cliente</span>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{selectedTitulo.cliente}</p>
                        {selectedTitulo.fantasia && selectedTitulo.fantasia !== selectedTitulo.cliente && (
                          <p className="text-xs text-muted-foreground">{selectedTitulo.fantasia}</p>
                        )}
                      </div>
                      <Button variant="outline" size="sm" className="text-xs h-7 gap-1 shrink-0" onClick={() => { setSelectedTitulo(null); navigate(`/lara/clientes/${selectedTitulo.codcli}`); }}>
                        <ExternalLink className="h-3 w-3" /> Ver cliente
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Cód. Cliente</span>
                        <p className="font-mono font-medium">{selectedTitulo.codcli}</p>
                      </div>
                      {selectedTitulo.telefone && (
                        <div>
                          <span className="text-muted-foreground">Telefone</span>
                          <p className="font-medium">{selectedTitulo.telefone}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Financeiro */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Banknote className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Financeiro</span>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Valor Original</span>
                      <p className="text-sm font-semibold text-foreground">{formatCurrency(selectedTitulo.valor)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Valor a Receber</span>
                      <p className="text-sm font-bold text-primary">{formatCurrency(selectedTitulo.vlreceber)}</p>
                    </div>
                    {selectedTitulo.vldesc > 0 && (
                      <div>
                        <span className="text-muted-foreground">Desconto</span>
                        <p className="text-sm font-medium text-emerald-600">-{formatCurrency(selectedTitulo.vldesc)}</p>
                      </div>
                    )}
                    {selectedTitulo.cmulta_prev > 0 && (
                      <div>
                        <span className="text-muted-foreground">Multa Prevista ({selectedTitulo.percmulta}%)</span>
                        <p className="text-sm font-medium text-red-600">{formatCurrency(selectedTitulo.cmulta_prev)}</p>
                      </div>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Datas */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Datas</span>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Emissão</span>
                      <p className="font-medium">{selectedTitulo.dtemissao || '—'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Vencimento</span>
                      <p className={`font-semibold ${selectedTitulo.dias_atraso > 0 ? 'text-red-600' : 'text-foreground'}`}>
                        {selectedTitulo.vencimento}
                      </p>
                    </div>
                    {selectedTitulo.titulo_com_data_prevista && selectedTitulo.dtrecebimento_previsto && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Data Prevista de Recebimento</span>
                        <p className="font-medium text-amber-600">{selectedTitulo.dtrecebimento_previsto}</p>
                      </div>
                    )}
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Atraso</span>
                      <p className={`text-sm font-bold ${selectedTitulo.dias_atraso > 30 ? 'text-red-600' : selectedTitulo.dias_atraso > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {selectedTitulo.dias_atraso > 0 ? `${selectedTitulo.dias_atraso} dias em atraso` : 'Em dia'}
                      </p>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Cobrança */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cobrança / Origem</span>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Modalidade</span>
                      <p className="font-medium">{selectedTitulo.cobranca || selectedTitulo.codcob}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Filial</span>
                      <p className="font-medium">{selectedTitulo.filial || '—'}</p>
                    </div>
                    {selectedTitulo.rca && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">RCA / Vendedor</span>
                        <p className="font-medium">{selectedTitulo.rca}</p>
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground">Última Ação</span>
                      <p className="font-medium">{selectedTitulo.ultima_acao || '—'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Responsável</span>
                      <p className="font-medium">{selectedTitulo.responsavel || '—'}</p>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Ações */}
                <div className="flex gap-2 pt-1 pb-4">
                  <Button
                    className="flex-1"
                    variant="outline"
                    size="sm"
                    disabled={boletoMutation.isPending}
                    onClick={() => boletoMutation.mutate({ codcli: Number(selectedTitulo.codcli), duplicata: selectedTitulo.duplicata })}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                    Enviar Boleto
                  </Button>
                  <Button
                    className="flex-1"
                    variant="outline"
                    size="sm"
                    disabled={pixMutation.isPending}
                    onClick={() => pixMutation.mutate({ codcli: Number(selectedTitulo.codcli), duplicata: selectedTitulo.duplicata })}
                  >
                    <Send className="h-3.5 w-3.5 mr-1.5" />
                    Enviar PIX
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </LaraLayout>
  );
}
