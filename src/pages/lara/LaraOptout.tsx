import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { CardKPI } from '@/components/lara/CardKPI';
import { FilterBar } from '@/components/lara/FilterBar';
import { EmptyState } from '@/components/lara/EmptyState';
import { ShieldBan, ShieldCheck, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { disableOptout, getOptouts, setOptout } from '@/services/laraApi';
import { useLaraFiliaisFilter } from '@/contexts/LaraFiliaisContext';

export default function LaraOptout() {
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();
  const { filiaisApiParam, selectedFiliaisKey } = useLaraFiliaisFilter();

  const { data } = useQuery({
    queryKey: ['lara-optout', selectedFiliaisKey],
    queryFn: () => getOptouts({ filiais: filiaisApiParam }),
    staleTime: 30_000,
  });

  const optouts = data ?? [];

  const mutation = useMutation({
    mutationFn: async (item: any) => {
      if (item.ativo) {
        return disableOptout(item.id);
      }
      return setOptout({
        wa_id: item.wa_id,
        codcli: item.codcli ? Number(item.codcli) : undefined,
        cliente: item.cliente,
        motivo: item.motivo || 'Reativacao manual',
        observacao: item.observacao,
        ativo: true,
        origem: 'ui-optout',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lara-optout'] });
      queryClient.invalidateQueries({ queryKey: ['lara-clientes'] });
      queryClient.invalidateQueries({ queryKey: ['lara-dashboard'] });
    },
  });

  const ativos = optouts.filter(o => o.ativo).length;
  const inativos = optouts.filter(o => !o.ativo).length;

  const filtered = optouts.filter(o =>
    !search || o.cliente.toLowerCase().includes(search.toLowerCase()) ||
    o.codcli.includes(search) || o.wa_id.includes(search)
  );

  return (
    <LaraLayout>
      <PageHeader title="Opt-out / Compliance" subtitle="Controle de bloqueio e retomada de contato" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <CardKPI label="Opt-outs Ativos" value={ativos} icon={<ShieldBan className="h-4 w-4" />} />
        <CardKPI label="Opt-outs Removidos" value={inativos} icon={<ShieldCheck className="h-4 w-4" />} />
        <CardKPI label="Total Registros" value={optouts.length} icon={<ShieldOff className="h-4 w-4" />} />
      </div>

      <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Buscar por cliente, codcli, wa_id..." />

      {filtered.length === 0 ? <EmptyState /> : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  {['wa_id', 'Codcli', 'Cliente', 'Motivo', 'Status', 'Criacao', 'Atualizacao', 'Origem', 'Observacao', ''].map(h => (
                    <th key={h} className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => (
                  <tr key={o.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="py-2.5 px-2 font-mono text-xs">{o.wa_id}</td>
                    <td className="py-2.5 px-2 font-mono text-xs">{o.codcli}</td>
                    <td className="py-2.5 px-2 text-xs font-medium">{o.cliente}</td>
                    <td className="py-2.5 px-2 text-xs">{o.motivo}</td>
                    <td className="py-2.5 px-2">
                      <Badge variant={o.ativo ? 'destructive' : 'secondary'} className="text-[10px]">
                        {o.ativo ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-2 text-xs">{o.data_criacao}</td>
                    <td className="py-2.5 px-2 text-xs">{o.data_atualizacao}</td>
                    <td className="py-2.5 px-2 text-xs">{o.origem}</td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground max-w-[180px] truncate">{o.observacao}</td>
                    <td className="py-2.5 px-2">
                      <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => mutation.mutate(o)}>
                        {o.ativo ? 'Remover' : 'Reativar'}
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

