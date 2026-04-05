import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { CardKPI } from '@/components/lara/CardKPI';
import { HealthIndicator } from '@/components/lara/HealthIndicator';
import { AlertCard } from '@/components/lara/AlertCard';
import { SeverityBadge } from '@/components/lara/SeverityBadge';
import { mockLogs } from '@/data/lara-mock';
import { Activity, MessageSquare, AlertTriangle, XCircle, Clock } from 'lucide-react';

const criticalLogs = mockLogs.filter(l => l.severidade === 'erro');

export default function LaraMonitoramento() {
  return (
    <LaraLayout>
      <PageHeader title="Monitoramento" subtitle="Torre de controle operacional da Lara" />

      {/* Saúde de componentes */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-foreground mb-3">Saúde dos Componentes</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <HealthIndicator label="WhatsApp" status="operacional" detail="Última verificação: 09:20" />
          <HealthIndicator label="Redis" status="operacional" detail="Latência: 2ms" />
          <HealthIndicator label="Oracle / WinThor" status="degradado" detail="Timeout registrado às 11:45" />
          <HealthIndicator label="Backend / API" status="operacional" detail="Uptime: 99,8%" />
        </div>
      </div>

      {/* KPIs operacionais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <CardKPI label="Atendimentos Hoje" value={14} icon={<MessageSquare className="h-4 w-4" />} />
        <CardKPI label="Fila Pendente" value={3} icon={<Clock className="h-4 w-4" />} />
        <CardKPI label="Erros de Boleto" value={1} icon={<XCircle className="h-4 w-4" />} />
        <CardKPI label="Erros da Régua" value={4} icon={<AlertTriangle className="h-4 w-4" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Eventos críticos */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Eventos Críticos Recentes</h3>
          <div className="space-y-3">
            <AlertCard type="error" title="Falha na integração Oracle" description="Timeout na consulta de títulos em 04/04 às 11:45. Conexão restaurada automaticamente." />
            <AlertCard type="warning" title="Disparo D+3 com 2 erros de entrega" description="2 mensagens não entregues por número inválido. Verificar base de contatos." />
            <AlertCard type="warning" title="Cliente escalado para humano" description="Rodrigues Revenda Colchões Ltda solicitou contato manual em 05/04." />
          </div>
        </div>

        {/* Resumo operacional */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Resumo Operacional do Dia</h3>
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-foreground">Mensagens enviadas</span>
              <span className="text-sm font-bold text-foreground">147</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-foreground">Mensagens recebidas</span>
              <span className="text-sm font-bold text-foreground">42</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-foreground">Boletos gerados</span>
              <span className="text-sm font-bold text-foreground">23</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-foreground">PIX enviados</span>
              <span className="text-sm font-bold text-foreground">8</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-foreground">Promessas registradas</span>
              <span className="text-sm font-bold text-foreground">5</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-foreground">Opt-outs aplicados</span>
              <span className="text-sm font-bold text-foreground">1</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-foreground">Escalações humanas</span>
              <span className="text-sm font-bold text-foreground">2</span>
            </div>
          </div>
        </div>
      </div>

      {/* Log recente */}
      <div className="mt-6 rounded-lg border bg-card overflow-hidden">
        <div className="p-4 border-b">
          <h3 className="text-sm font-semibold text-foreground">Últimos Eventos</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                {['Hora', 'Severidade', 'Tipo', 'Mensagem'].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mockLogs.slice(0, 5).map(l => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="py-2 px-3 text-xs">{l.data_hora}</td>
                  <td className="py-2 px-3"><SeverityBadge severity={l.severidade} /></td>
                  <td className="py-2 px-3 text-xs font-medium">{l.tipo}</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{l.mensagem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </LaraLayout>
  );
}
