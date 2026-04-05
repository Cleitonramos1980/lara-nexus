import { useState } from 'react';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { CardKPI } from '@/components/lara/CardKPI';
import { FilterBar } from '@/components/lara/FilterBar';
import { SeverityBadge } from '@/components/lara/SeverityBadge';
import { EmptyState } from '@/components/lara/EmptyState';
import { mockLogs } from '@/data/lara-mock';
import { ScrollText, AlertTriangle, XCircle, CheckCircle, ShieldBan } from 'lucide-react';

const eventosHoje = mockLogs.length;
const falhasEnvio = mockLogs.filter(l => l.severidade === 'erro').length;
const sucessos = mockLogs.filter(l => l.severidade === 'sucesso').length;
const bloqueados = mockLogs.filter(l => l.severidade === 'bloqueado').length;

export default function LaraLogs() {
  const [search, setSearch] = useState('');

  const filtered = mockLogs.filter(l =>
    !search || l.cliente.toLowerCase().includes(search.toLowerCase()) ||
    l.tipo.toLowerCase().includes(search.toLowerCase()) ||
    l.mensagem.toLowerCase().includes(search.toLowerCase()) ||
    l.codcli.includes(search)
  );

  return (
    <LaraLayout>
      <PageHeader title="Logs e Auditoria" subtitle="Observabilidade operacional da plataforma" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <CardKPI label="Eventos Hoje" value={eventosHoje} icon={<ScrollText className="h-4 w-4" />} />
        <CardKPI label="Sucessos" value={sucessos} icon={<CheckCircle className="h-4 w-4" />} />
        <CardKPI label="Falhas" value={falhasEnvio} icon={<XCircle className="h-4 w-4" />} />
        <CardKPI label="Bloqueados" value={bloqueados} icon={<ShieldBan className="h-4 w-4" />} />
      </div>

      <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Buscar por tipo, cliente, mensagem..." />

      {filtered.length === 0 ? <EmptyState /> : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  {['Data/Hora', 'Severidade', 'Tipo', 'Módulo', 'Cliente', 'Codcli', 'Etapa', 'Mensagem', 'Status'].map(h => (
                    <th key={h} className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(l => (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="py-2.5 px-2 text-xs whitespace-nowrap">{l.data_hora}</td>
                    <td className="py-2.5 px-2"><SeverityBadge severity={l.severidade} /></td>
                    <td className="py-2.5 px-2 text-xs font-medium">{l.tipo}</td>
                    <td className="py-2.5 px-2 text-xs">{l.modulo}</td>
                    <td className="py-2.5 px-2 text-xs max-w-[140px] truncate">{l.cliente}</td>
                    <td className="py-2.5 px-2 font-mono text-xs">{l.codcli}</td>
                    <td className="py-2.5 px-2 text-xs">{l.etapa}</td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground max-w-[250px] truncate">{l.mensagem}</td>
                    <td className="py-2.5 px-2 text-xs">{l.status}</td>
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
