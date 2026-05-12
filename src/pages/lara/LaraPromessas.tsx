import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { CardKPI } from '@/components/lara/CardKPI';
import { FilterBar } from '@/components/lara/FilterBar';
import { EmptyState } from '@/components/lara/EmptyState';
import { StatusBadge } from '@/components/lara/StatusBadge';
import { Handshake, CheckCircle, Clock, XCircle } from 'lucide-react';
import { getPromessas } from '@/services/laraApi';
import { formatCurrency } from '@/data/lara-mock';

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return value;
}

export default function LaraPromessas() {
  const [search, setSearch] = useState('');

  const { data } = useQuery({
    queryKey: ['lara-promessas'],
    queryFn: () => getPromessas({ limit: 2000 }),
    staleTime: 20_000,
  });

  const promessas = data ?? [];

  const total = promessas.length;
  const abertas = promessas.filter(p => !['paga', 'cancelada', 'acordo_fechado', 'encerrada'].includes(p.status)).length;
  const realizadas = promessas.filter(p => p.status === 'followup_realizado').length;
  const canceladas = promessas.filter(p => ['cancelada', 'encerrada'].includes(p.status)).length;

  const filtered = promessas.filter(p =>
    !search ||
    p.cliente.toLowerCase().includes(search.toLowerCase()) ||
    p.duplicatas.includes(search) ||
    String(p.codcli ?? '').includes(search) ||
    p.wa_id.includes(search) ||
    p.status.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <LaraLayout>
      <PageHeader title="Promessas de Pagamento" subtitle="Agendamentos de pagamento registrados pela Lara" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <CardKPI label="Total Promessas" value={total} icon={<Handshake className="h-4 w-4" />} />
        <CardKPI label="Em Aberto" value={abertas} icon={<Clock className="h-4 w-4" />} />
        <CardKPI label="Follow-up Realizado" value={realizadas} icon={<CheckCircle className="h-4 w-4" />} />
        <CardKPI label="Canceladas" value={canceladas} icon={<XCircle className="h-4 w-4" />} />
      </div>

      <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Buscar por cliente, duplicata, codcli, status..." />

      {filtered.length === 0 ? <EmptyState /> : (
        <div className="rounded-lg border bg-card overflow-hidden mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  {['Data', 'Cliente', 'Codcli', 'WA ID', 'Duplicatas', 'Valor Total', 'Data Prometida', 'Status', 'Origem', 'Atualizado em'].map(h => (
                    <th key={h} className="text-left py-3 px-2 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="py-2.5 px-2 text-xs whitespace-nowrap">{p.created_at}</td>
                    <td className="py-2.5 px-2 text-xs max-w-[140px] truncate font-medium">{p.cliente || '-'}</td>
                    <td className="py-2.5 px-2 font-mono text-xs">{p.codcli ?? '-'}</td>
                    <td className="py-2.5 px-2 font-mono text-xs text-muted-foreground">{p.wa_id || '-'}</td>
                    <td className="py-2.5 px-2 font-mono text-xs">{p.duplicatas || '-'}</td>
                    <td className="py-2.5 px-2 text-xs font-medium">{formatCurrency(p.valor_total)}</td>
                    <td className="py-2.5 px-2 text-xs">{formatDate(p.data_prometida)}</td>
                    <td className="py-2.5 px-2"><StatusBadge status={p.status} /></td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground">{p.origem || '-'}</td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground whitespace-nowrap">{p.updated_at || '-'}</td>
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
