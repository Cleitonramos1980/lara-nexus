import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { CardKPI } from '@/components/lara/CardKPI';
import { EtapaReguaBadge } from '@/components/lara/EtapaReguaBadge';
import { StatusBadge } from '@/components/lara/StatusBadge';
import { mockReguaEtapas, mockReguaExecucoes, formatCurrency } from '@/data/lara-mock';
import { Zap, TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

const totalElegivel = mockReguaEtapas.reduce((s, e) => s + e.elegivel, 0);
const totalRespondido = mockReguaEtapas.reduce((s, e) => s + e.respondido, 0);
const totalConvertido = mockReguaEtapas.reduce((s, e) => s + e.convertido, 0);
const totalErro = mockReguaEtapas.reduce((s, e) => s + e.erro, 0);

const chartData = mockReguaEtapas.map(e => ({
  etapa: e.etapa,
  'Taxa Resposta': e.taxa_resposta,
  'Taxa Recuperação': e.taxa_recuperacao,
}));

export default function LaraReguaAtiva() {
  return (
    <LaraLayout>
      <PageHeader title="Régua Ativa" subtitle="Monitoramento de performance da régua de cobrança" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <CardKPI label="Total Elegível" value={totalElegivel} icon={<Zap className="h-4 w-4" />} />
        <CardKPI label="Responderam" value={totalRespondido} icon={<TrendingUp className="h-4 w-4" />} trend={{ value: `${((totalRespondido / totalElegivel) * 100).toFixed(1)}%`, positive: true }} />
        <CardKPI label="Convertidos" value={totalConvertido} icon={<CheckCircle className="h-4 w-4" />} />
        <CardKPI label="Com Erro" value={totalErro} icon={<AlertTriangle className="h-4 w-4" />} />
      </div>

      {/* Cards por etapa */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {mockReguaEtapas.map(e => (
          <div key={e.etapa} className="rounded-lg border bg-card p-4">
            <div className="flex justify-center mb-2"><EtapaReguaBadge etapa={e.etapa} /></div>
            <div className="space-y-1 text-center">
              <div className="text-xl font-bold text-foreground">{e.elegivel}</div>
              <div className="text-[10px] text-muted-foreground">elegíveis</div>
              <div className="grid grid-cols-2 gap-1 mt-2 text-[10px]">
                <div><span className="font-semibold text-emerald-700">{e.enviado}</span> enviados</div>
                <div><span className="font-semibold text-blue-700">{e.respondido}</span> responderam</div>
                <div><span className="font-semibold text-violet-700">{e.convertido}</span> convertidos</div>
                <div><span className="font-semibold text-red-600">{e.erro}</span> erros</div>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">{e.bloqueado_optout} bloqueados por opt-out</div>
            </div>
          </div>
        ))}
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Performance por Etapa</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,88%)" />
              <XAxis dataKey="etapa" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" />
              <Tooltip />
              <Line type="monotone" dataKey="Taxa Resposta" stroke="hsl(215,80%,28%)" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="Taxa Recuperação" stroke="hsl(152,60%,40%)" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Volume por Etapa</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={mockReguaEtapas}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,88%)" />
              <XAxis dataKey="etapa" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="elegivel" fill="hsl(215,80%,28%)" name="Elegível" radius={[4, 4, 0, 0]} />
              <Bar dataKey="respondido" fill="hsl(152,60%,40%)" name="Respondido" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Execuções */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="p-4 border-b">
          <h3 className="text-sm font-semibold text-foreground">Execuções da Régua</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                {['Data/Hora', 'Etapa', 'Elegíveis', 'Disparados', 'Erros', 'Responderam', 'Valor Impactado', 'Status'].map(h => (
                  <th key={h} className="text-left py-3 px-3 text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mockReguaExecucoes.map(r => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="py-2.5 px-3 text-xs">{r.data_hora}</td>
                  <td className="py-2.5 px-3"><EtapaReguaBadge etapa={r.etapa} /></td>
                  <td className="py-2.5 px-3 text-xs">{r.elegivel}</td>
                  <td className="py-2.5 px-3 text-xs">{r.disparada}</td>
                  <td className="py-2.5 px-3 text-xs">{r.erro > 0 ? <span className="text-red-600 font-semibold">{r.erro}</span> : '0'}</td>
                  <td className="py-2.5 px-3 text-xs">{r.respondida}</td>
                  <td className="py-2.5 px-3 text-xs font-medium">{formatCurrency(r.valor_impactado)}</td>
                  <td className="py-2.5 px-3"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </LaraLayout>
  );
}
