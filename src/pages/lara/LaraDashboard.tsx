import { useQuery } from "@tanstack/react-query";
import { LaraLayout } from "@/components/lara/LaraLayout";
import { PageHeader } from "@/components/lara/PageHeader";
import { CardKPI } from "@/components/lara/CardKPI";
import { EtapaReguaBadge } from "@/components/lara/EtapaReguaBadge";
import { AlertCard } from "@/components/lara/AlertCard";
import { RiskBadge } from "@/components/lara/RiskBadge";
import { formatCurrency } from "@/data/lara-mock";
import {
  AlertTriangle,
  Bot,
  Brain,
  CalendarClock,
  DollarSign,
  FileText,
  Handshake,
  MessageSquare,
  ShieldBan,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getDashboard } from "@/services/laraApi";
import { useLaraFiliaisFilter } from "@/contexts/LaraFiliaisContext";

const PIE_COLORS = ["#059669", "#2563eb", "#7c3aed", "#d97706", "#0d9488", "#ea580c"];

function formatFilialLabel(value: string): string {
  const normalized = String(value ?? "").trim();
  return normalized || "-";
}

function formatPercent(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  const normalized = safeValue <= 1 ? safeValue * 100 : safeValue;
  return `${normalized.toFixed(1)}%`;
}

export default function LaraDashboard() {
  const { filiaisApiParam, selectedFiliaisKey } = useLaraFiliaisFilter();

  const { data } = useQuery({
    queryKey: ["lara-dashboard", selectedFiliaisKey],
    queryFn: () => getDashboard({ filiais: filiaisApiParam }),
    staleTime: 60_000,
  });

  const kpis = data?.kpis;
  const reguaEtapas = data?.reguaEtapas ?? [];
  const faixaAtrasoData = data?.faixaAtraso ?? [];
  const statusPieData = data?.statusPie ?? [];
  const topClientes = data?.topClientes ?? [];
  const alertas = data?.alertas ?? [];
  const classificador = data?.classificador;
  const classificadorIntents = classificador?.intents ?? [];
  const totalClassificacoes = classificador?.total_classificacoes ?? 0;
  const openaiUsado = classificador?.openai_usado ?? 0;
  const fallbackLocal = classificador?.fallback_local ?? 0;
  const taxaOpenAi = totalClassificacoes > 0 ? (openaiUsado / totalClassificacoes) * 100 : 0;
  const taxaFallback = totalClassificacoes > 0 ? (fallbackLocal / totalClassificacoes) * 100 : 0;

  return (
    <LaraLayout>
      <PageHeader title="Dashboard Executivo" subtitle="Visao consolidada da operacao de cobranca" />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <CardKPI label="Total em Aberto" value={formatCurrency(kpis?.totalAberto ?? 0)} icon={<DollarSign className="h-4 w-4" />} />
        <CardKPI label="Clientes c/ Titulos" value={kpis?.clientesAberto ?? 0} icon={<Users className="h-4 w-4" />} />
        <CardKPI label="Boletos Enviados" value={kpis?.boletoEnviados ?? 0} icon={<FileText className="h-4 w-4" />} />
        <CardKPI label="Interacoes Hoje" value={kpis?.interacoesHoje ?? 0} icon={<MessageSquare className="h-4 w-4" />} />
        <CardKPI label="Promessas" value={kpis?.promessas ?? 0} icon={<Handshake className="h-4 w-4" />} />
        <CardKPI label="Opt-outs Ativos" value={kpis?.optouts ?? 0} icon={<ShieldBan className="h-4 w-4" />} />
        <CardKPI label="Na Regua Ativa" value={kpis?.reguaAtiva ?? 0} icon={<Zap className="h-4 w-4" />} />
        <CardKPI label="Taxa de Resposta" value={`${(kpis?.taxaResposta ?? 0).toFixed(1)}%`} icon={<TrendingUp className="h-4 w-4" />} />
        <CardKPI label="Valor Recuperado" value={formatCurrency(kpis?.valorRecuperado ?? 0)} icon={<DollarSign className="h-4 w-4" />} />
        <CardKPI label="Vencendo Hoje" value={formatCurrency(faixaAtrasoData[0]?.valor ?? 0)} icon={<CalendarClock className="h-4 w-4" />} />
        <CardKPI label="Vencido > 30 dias" value={formatCurrency((faixaAtrasoData[2]?.valor ?? 0) + (faixaAtrasoData[3]?.valor ?? 0) + (faixaAtrasoData[4]?.valor ?? 0))} icon={<AlertTriangle className="h-4 w-4" />} />
        <CardKPI
          label="Taxa Recuperacao"
          value={reguaEtapas.length ? `${(reguaEtapas.reduce((sum, etapa) => sum + etapa.taxa_recuperacao, 0) / reguaEtapas.length).toFixed(1)}%` : "0,0%"}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <CardKPI label="Classificacoes IA" value={totalClassificacoes} icon={<Brain className="h-4 w-4" />} />
        <CardKPI label="Taxa OpenAI" value={`${taxaOpenAi.toFixed(1)}%`} icon={<Bot className="h-4 w-4" />} />
        <CardKPI label="Fallback Local" value={`${taxaFallback.toFixed(1)}%`} icon={<AlertTriangle className="h-4 w-4" />} />
        <CardKPI label="Acuracia Estimada IA" value={formatPercent(classificador?.acuracia_estimada_media ?? 0)} icon={<TrendingUp className="h-4 w-4" />} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-5">
          <h3 className="mb-4 text-sm font-semibold text-foreground">Distribuicao por Faixa de Atraso</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={faixaAtrasoData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,88%)" />
              <XAxis dataKey="faixa" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `R$${(value / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Bar dataKey="valor" fill="hsl(215,80%,28%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <h3 className="mb-4 text-sm font-semibold text-foreground">Status dos Atendimentos</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={statusPieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value">
                {statusPieData.map((_, index) => (
                  <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mb-6 rounded-lg border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold text-foreground">Funil por Etapa da Regua Ativa</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {reguaEtapas.map((etapa) => (
            <div key={etapa.etapa} className="rounded-lg border p-3 text-center">
              <EtapaReguaBadge etapa={etapa.etapa} />
              <div className="mt-2 text-lg font-bold text-foreground">{etapa.elegivel}</div>
              <div className="text-[10px] text-muted-foreground">elegiveis</div>
              <div className="mt-1 text-xs font-medium text-foreground">{etapa.respondido} responderam</div>
              <div className="text-[10px] text-muted-foreground">{etapa.taxa_resposta}% resposta</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-6 rounded-lg border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Classificador IA por Intent</h3>
          <span className="text-xs text-muted-foreground">{classificadorIntents.length} intents mapeadas</span>
        </div>
        {classificadorIntents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados de classificacao para o filtro atual.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Intent</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Total</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">OpenAI</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Fallback</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Acuracia</th>
                </tr>
              </thead>
              <tbody>
                {classificadorIntents.map((item) => (
                  <tr key={item.intent} className="border-b last:border-0">
                    <td className="px-3 py-2 text-sm font-medium text-foreground">{item.intent}</td>
                    <td className="px-3 py-2 text-sm text-foreground">{item.total}</td>
                    <td className="px-3 py-2 text-sm text-foreground">{item.openai}</td>
                    <td className="px-3 py-2 text-sm text-foreground">{item.fallback}</td>
                    <td className="px-3 py-2 text-sm text-foreground">{formatPercent(item.acuracia_media)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-5">
          <h3 className="mb-4 text-sm font-semibold text-foreground">Maiores Saldos em Aberto</h3>
          <div className="space-y-2">
            {topClientes
              .filter((cliente) => cliente.total_aberto > 0)
              .slice(0, 5)
              .map((cliente, index) => (
                <div key={cliente.codcli} className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted/50">
                  <div className="flex items-center gap-3">
                    <span className="w-4 text-xs font-mono text-muted-foreground">{index + 1}</span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{cliente.cliente}</p>
                      <p className="text-[10px] text-muted-foreground">{formatFilialLabel(cliente.filial)} - {cliente.qtd_titulos} titulos</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-right">
                    <RiskBadge risk={cliente.risco} />
                    <span className="text-sm font-bold text-foreground">{formatCurrency(cliente.total_aberto)}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Alertas Operacionais</h3>
          {alertas.length === 0 ? (
            <AlertCard type="info" title="Sem alertas no momento" description="Nao ha alertas criticos registrados." />
          ) : (
            alertas.map((alerta, index) => (
              <AlertCard
                key={`${alerta.title}-${index}`}
                type={alerta.type === "error" || alerta.type === "warning" || alerta.type === "info" ? alerta.type : "info"}
                title={alerta.title}
                description={alerta.description}
              />
            ))
          )}
        </div>
      </div>
    </LaraLayout>
  );
}
