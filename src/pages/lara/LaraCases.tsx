import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { FilterBar } from '@/components/lara/FilterBar';
import { EmptyState } from '@/components/lara/EmptyState';
import { formatCurrency } from '@/data/lara-mock';
import { getCases } from '@/services/laraApi';
import { useLaraFiliaisFilter } from '@/contexts/LaraFiliaisContext';

const acaoColors: Record<string, string> = {
  PAGAMENTO_ENVIADO: 'bg-emerald-100 text-emerald-800',
  PROMESSA_PAGAMENTO: 'bg-violet-100 text-violet-800',
  NEGOCIACAO: 'bg-blue-100 text-blue-800',
  INFO: 'bg-slate-100 text-slate-700',
  ATIVO_DISPARO: 'bg-sky-100 text-sky-800',
  OPTOUT_SET: 'bg-red-100 text-red-700',
  OPTOUT_CLEAR: 'bg-emerald-100 text-emerald-700',
  BOLETO_REENVIADO: 'bg-amber-100 text-amber-800',
  ERRO_OPERACIONAL: 'bg-red-100 text-red-800',
  ESCALACAO_HUMANA: 'bg-orange-100 text-orange-800',
};

export default function LaraCases() {
  const [search, setSearch] = useState('');
  const { filiaisApiParam, selectedFiliaisKey } = useLaraFiliaisFilter();

  const { data } = useQuery({
    queryKey: ['lara-cases', selectedFiliaisKey],
    queryFn: () => getCases({ filiais: filiaisApiParam }),
    staleTime: 30_000,
  });

  const cases = data ?? [];

  const filtered = cases.filter(c =>
    !search || c.cliente.toLowerCase().includes(search.toLowerCase()) ||
    c.codcli.includes(search) || c.acao.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <LaraLayout>
      <PageHeader title="Cases" subtitle="Historico operacional de acoes da cobranca" />
      <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Buscar por cliente, codcli, acao..." />

      {filtered.length === 0 ? <EmptyState /> : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  {['Data/Hora', 'Acao', 'Cliente', 'Codcli', 'Duplicatas', 'Valor', 'Pagamento', 'Origem', 'Responsavel', 'Detalhe'].map(h => (
                    <th key={h} className="text-left py-3 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="py-2.5 px-2 text-xs whitespace-nowrap">{c.data_hora}</td>
                    <td className="py-2.5 px-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold font-mono ${acaoColors[c.acao] || 'bg-gray-100 text-gray-700'}`}>{c.acao}</span>
                    </td>
                    <td className="py-2.5 px-2 text-xs font-medium max-w-[160px] truncate">{c.cliente}</td>
                    <td className="py-2.5 px-2 font-mono text-xs">{c.codcli}</td>
                    <td className="py-2.5 px-2 font-mono text-xs max-w-[140px] truncate">{c.duplicatas}</td>
                    <td className="py-2.5 px-2 text-xs font-medium">{formatCurrency(c.valor_total)}</td>
                    <td className="py-2.5 px-2 text-xs">{c.forma_pagamento}</td>
                    <td className="py-2.5 px-2 text-xs">{c.origem}</td>
                    <td className="py-2.5 px-2 text-xs">{c.responsavel}</td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground max-w-[200px] truncate">{c.detalhe}</td>
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

