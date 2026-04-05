import { useState } from 'react';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { CardKPI } from '@/components/lara/CardKPI';
import { StatusBadge } from '@/components/lara/StatusBadge';
import { EtapaReguaBadge } from '@/components/lara/EtapaReguaBadge';
import { AlertCard } from '@/components/lara/AlertCard';
import { RiskBadge } from '@/components/lara/RiskBadge';
import { mockClientes, mockTitulos, formatCurrency, mockReguaEtapas } from '@/data/lara-mock';
import { DollarSign, Users, FileText, MessageSquare, Handshake, ShieldBan, Zap, TrendingUp, CalendarClock, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const totalAberto = mockClientes.reduce((s, c) => s + c.total_aberto, 0);
const clientesAberto = mockClientes.filter(c => c.total_aberto > 0).length;
const boletoEnviados = mockTitulos.filter(t => t.boleto_disponivel).length;
const promessas = mockClientes.filter(c => c.status === 'Promessa registrada').length;
const optouts = mockClientes.filter(c => c.optout).length;
const reguaAtiva = mockClientes.filter(c => c.etapa_regua !== '-').length;

const faixaAtrasoData = [
  { faixa: '0-7 dias', valor: 8750 },
  { faixa: '8-30 dias', valor: 25815 },
  { faixa: '31-90 dias', valor: 30230.5 },
  { faixa: '91-180 dias', valor: 62130 },
  { faixa: '180+ dias', valor: 187054.5 },
];

const statusPieData = [
  { name: 'Boleto enviado', value: 2 },
  { name: 'Cliente respondeu', value: 1 },
  { name: 'Promessa registrada', value: 1 },
  { name: 'Aguardando resposta', value: 1 },
  { name: 'PIX enviado', value: 1 },
  { name: 'Escalado para humano', value: 1 },
];

const PIE_COLORS = ['#059669', '#2563eb', '#7c3aed', '#d97706', '#0d9488', '#ea580c'];

export default function LaraDashboard() {
  const [filial, setFilial] = useState('todas');

  return (
    <LaraLayout>
      <PageHeader
        title="Dashboard Executivo"
        subtitle="Visão consolidada da operação de cobrança"
      />

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-6">
        <Select value={filial} onValueChange={setFilial}>
          <SelectTrigger className="w-[180px] h-9 bg-card">
            <SelectValue placeholder="Filial" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as filiais</SelectItem>
            <SelectItem value="Matriz Manaus">Matriz Manaus</SelectItem>
            <SelectItem value="Filial Belém">Filial Belém</SelectItem>
            <SelectItem value="Filial Agrestina">Filial Agrestina</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 mb-6">
        <CardKPI label="Total em Aberto" value={formatCurrency(totalAberto)} icon={<DollarSign className="h-4 w-4" />} />
        <CardKPI label="Clientes c/ Títulos" value={clientesAberto} icon={<Users className="h-4 w-4" />} />
        <CardKPI label="Boletos Enviados" value={boletoEnviados} icon={<FileText className="h-4 w-4" />} />
        <CardKPI label="Interações Hoje" value={14} icon={<MessageSquare className="h-4 w-4" />} trend={{ value: '+23%', positive: true }} />
        <CardKPI label="Promessas" value={promessas} icon={<Handshake className="h-4 w-4" />} />
        <CardKPI label="Opt-outs Ativos" value={optouts} icon={<ShieldBan className="h-4 w-4" />} />
        <CardKPI label="Na Régua Ativa" value={reguaAtiva} icon={<Zap className="h-4 w-4" />} />
        <CardKPI label="Taxa de Resposta" value="33,2%" icon={<TrendingUp className="h-4 w-4" />} trend={{ value: '+5,1%', positive: true }} />
        <CardKPI label="Valor Recuperado" value={formatCurrency(38394.50)} icon={<DollarSign className="h-4 w-4" />} trend={{ value: '+12%', positive: true }} />
        <CardKPI label="Vencendo Hoje" value={formatCurrency(8750)} icon={<CalendarClock className="h-4 w-4" />} />
        <CardKPI label="Vencido > 30 dias" value={formatCurrency(279414.5)} icon={<AlertTriangle className="h-4 w-4" />} />
        <CardKPI label="Taxa Recuperação" value="8,9%" icon={<TrendingUp className="h-4 w-4" />} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Distribuição por Faixa de Atraso</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={faixaAtrasoData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,88%)" />
              <XAxis dataKey="faixa" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="valor" fill="hsl(215,80%,28%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Status dos Atendimentos</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={statusPieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value">
                {statusPieData.map((_, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Funil régua */}
      <div className="rounded-lg border bg-card p-5 mb-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">Funil por Etapa da Régua Ativa</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {mockReguaEtapas.map(e => (
            <div key={e.etapa} className="rounded-lg border p-3 text-center">
              <EtapaReguaBadge etapa={e.etapa} />
              <div className="mt-2 text-lg font-bold text-foreground">{e.elegivel}</div>
              <div className="text-[10px] text-muted-foreground">elegíveis</div>
              <div className="mt-1 text-xs text-foreground font-medium">{e.respondido} responderam</div>
              <div className="text-[10px] text-muted-foreground">{e.taxa_resposta}% resposta</div>
            </div>
          ))}
        </div>
      </div>

      {/* Ranking maiores saldos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Maiores Saldos em Aberto</h3>
          <div className="space-y-2">
            {mockClientes.filter(c => c.total_aberto > 0).sort((a, b) => b.total_aberto - a.total_aberto).slice(0, 5).map((c, i) => (
              <div key={c.codcli} className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground w-4">{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{c.cliente}</p>
                    <p className="text-[10px] text-muted-foreground">{c.filial} · {c.qtd_titulos} títulos</p>
                  </div>
                </div>
                <div className="text-right flex items-center gap-2">
                  <RiskBadge risk={c.risco} />
                  <span className="text-sm font-bold text-foreground">{formatCurrency(c.total_aberto)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Alertas */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Alertas Operacionais</h3>
          <AlertCard type="warning" title="2 clientes aguardando resposta há mais de 48h" description="Mercantil Oliveira e Filhos está sem resposta desde 02/04." />
          <AlertCard type="error" title="Falha na integração Oracle" description="Timeout na consulta de títulos em 04/04 às 11:45. Verificar conexão." />
          <AlertCard type="warning" title="1 opt-out recente" description="Amazonas Lar e Conforto Ltda solicitou bloqueio em 28/03." />
          <AlertCard type="info" title="Disparo D+3 com 2 erros" description="45 elegíveis, 43 enviados com sucesso. 2 falhas de entrega." />
          <AlertCard type="error" title="3 títulos críticos acima de 180 dias" description="Rede Ponto Econômico e Rodrigues Revenda com saldo superior a R$ 100k." />
        </div>
      </div>
    </LaraLayout>
  );
}
