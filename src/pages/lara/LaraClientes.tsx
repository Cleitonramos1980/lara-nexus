import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { FilterBar } from '@/components/lara/FilterBar';
import { StatusBadge } from '@/components/lara/StatusBadge';
import { RiskBadge } from '@/components/lara/RiskBadge';
import { EtapaReguaBadge } from '@/components/lara/EtapaReguaBadge';
import { EmptyState } from '@/components/lara/EmptyState';
import { TableSkeleton } from '@/components/lara/TableSkeleton';
import { maskCpfCnpj, formatCurrency } from '@/data/lara-mock';
import { Eye, ShieldBan } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getClientes } from '@/services/laraApi';
import { useLaraFiliaisFilter } from '@/contexts/LaraFiliaisContext';

export default function LaraClientes() {
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const { filiaisApiParam, selectedFiliaisKey } = useLaraFiliaisFilter();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['lara-clientes', selectedFiliaisKey],
    queryFn: () => getClientes({ filiais: filiaisApiParam }),
    staleTime: 60_000,
  });

  const clientes = data ?? [];

  const filtered = clientes.filter(c =>
    !search ||
    c.cliente.toLowerCase().includes(search.toLowerCase()) ||
    c.codcli.includes(search) ||
    c.telefone.includes(search)
  );

  return (
    <LaraLayout>
      <PageHeader
        title="Clientes"
        subtitle="Consulte clientes, inadimplência, risco e situação financeira."
      />
      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar por nome, codcli, telefone..."
      />

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive mb-4 flex items-center justify-between">
          <span>Falha ao carregar clientes.</span>
          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={10} cols={10} />
      ) : filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  {['Codcli', 'Cliente', 'Telefone', 'CPF/CNPJ', 'Total Aberto', 'Títulos', 'Etapa', 'Status', 'Risco', 'Opt-out', ''].map(h => (
                    <th key={h} className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.codcli} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-3 font-mono text-xs">{c.codcli}</td>
                    <td className="py-3 px-3 font-medium">{c.cliente}</td>
                    <td className="py-3 px-3 text-xs">{c.telefone}</td>
                    <td className="py-3 px-3 font-mono text-xs">{maskCpfCnpj(c.cpf_cnpj)}</td>
                    <td className="py-3 px-3 font-medium">{formatCurrency(c.total_aberto)}</td>
                    <td className="py-3 px-3 text-center">{c.qtd_titulos}</td>
                    <td className="py-3 px-3"><EtapaReguaBadge etapa={c.etapa_regua} /></td>
                    <td className="py-3 px-3"><StatusBadge status={c.status} /></td>
                    <td className="py-3 px-3"><RiskBadge risk={c.risco} /></td>
                    <td className="py-3 px-3">
                      {c.optout && <ShieldBan className="h-4 w-4 text-red-500" />}
                    </td>
                    <td className="py-3 px-3">
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/lara/clientes/${c.codcli}`)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t bg-muted/10 text-xs text-muted-foreground">
            {filtered.length} cliente{filtered.length !== 1 ? 's' : ''}{search ? ` encontrado${filtered.length !== 1 ? 's' : ''}` : ' no total'}
          </div>
        </div>
      )}
    </LaraLayout>
  );
}
