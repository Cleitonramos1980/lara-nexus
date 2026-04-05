import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { FilterBar } from '@/components/lara/FilterBar';
import { StatusBadge } from '@/components/lara/StatusBadge';
import { RiskBadge } from '@/components/lara/RiskBadge';
import { EtapaReguaBadge } from '@/components/lara/EtapaReguaBadge';
import { EmptyState } from '@/components/lara/EmptyState';
import { mockClientes, maskCpfCnpj, formatCurrency } from '@/data/lara-mock';
import { Eye, ShieldBan } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function LaraClientes() {
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  const filtered = mockClientes.filter(c =>
    !search || c.cliente.toLowerCase().includes(search.toLowerCase()) ||
    c.codcli.includes(search) || c.telefone.includes(search)
  );

  return (
    <LaraLayout>
      <PageHeader title="Clientes" subtitle="Base de clientes da operação de cobrança" />
      <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Buscar por nome, codcli, telefone..." />

      {filtered.length === 0 ? (
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
                    <td className="py-3 px-3">{c.optout && <ShieldBan className="h-4 w-4 text-red-500" />}</td>
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
        </div>
      )}
    </LaraLayout>
  );
}
