import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { FilterBar } from '@/components/lara/FilterBar';
import { StatusBadge } from '@/components/lara/StatusBadge';
import { EtapaReguaBadge } from '@/components/lara/EtapaReguaBadge';
import { EmptyState } from '@/components/lara/EmptyState';
import { mockTitulos, formatCurrency } from '@/data/lara-mock';
import { Eye, RotateCcw, Send, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function LaraTitulos() {
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  const filtered = mockTitulos.filter(t =>
    !search || t.cliente.toLowerCase().includes(search.toLowerCase()) ||
    t.codcli.includes(search) || t.duplicata.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <LaraLayout>
      <PageHeader title="Títulos / Duplicatas" subtitle="Gestão operacional de títulos em aberto" />
      <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Buscar por cliente, codcli, duplicata..." />

      {filtered.length === 0 ? <EmptyState /> : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  {['Duplicata', 'Prest.', 'Codcli', 'Cliente', 'Valor', 'Vencimento', 'Atraso', 'Etapa', 'Status', 'Boleto', 'Filial', ''].map(h => (
                    <th key={h} className="text-left py-3 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-2 font-mono text-xs">{t.duplicata}</td>
                    <td className="py-2.5 px-2 text-xs">{t.prestacao}</td>
                    <td className="py-2.5 px-2 font-mono text-xs">{t.codcli}</td>
                    <td className="py-2.5 px-2 text-xs font-medium max-w-[180px] truncate">{t.cliente}</td>
                    <td className="py-2.5 px-2 font-semibold text-xs">{formatCurrency(t.valor)}</td>
                    <td className="py-2.5 px-2 text-xs">{t.vencimento}</td>
                    <td className="py-2.5 px-2 text-xs">{t.dias_atraso > 0 ? <span className={t.dias_atraso > 30 ? 'text-red-600 font-semibold' : ''}>{t.dias_atraso}d</span> : <span className="text-emerald-600">Em dia</span>}</td>
                    <td className="py-2.5 px-2"><EtapaReguaBadge etapa={t.etapa_regua} /></td>
                    <td className="py-2.5 px-2"><StatusBadge status={t.status_atendimento} /></td>
                    <td className="py-2.5 px-2">
                      <Badge variant={t.boleto_disponivel ? 'default' : 'secondary'} className="text-[10px]">
                        {t.boleto_disponivel ? 'Sim' : 'Não'}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground">{t.filial}</td>
                    <td className="py-2.5 px-2">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver detalhe"><Eye className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Reenviar boleto"><RotateCcw className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Enviar PIX"><Send className="h-3.5 w-3.5" /></Button>
                      </div>
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
