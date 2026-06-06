import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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
  Cpu,
  Target,
  Activity,
  FlaskConical,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getDashboard, getAlertasInteligentes } from "@/services/laraApi";
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
  const navigate = useNavigate();
  const { filiaisApiParam, selectedFiliaisKey } = useLaraFiliaisFilter();

  function goTitulos(params?: Record<string, string>) {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    navigate(`/lara/titulos${qs}`);
  }

  function handleFaixaClick(faixa: string) {
    if (faixa === "A vencer") return goTitulos({ avencer: "1" });
    if (faixa === "0-7 dias") return goTitulos({ atrasoMin: "0", atrasoMax: "7" });
    if (faixa === "8-30 dias") return goTitulos({ atrasoMin: "8", atrasoMax: "30" });
    if (faixa === "31-90 dias") return goTitulos({ atrasoMin: "31", atrasoMax: "90" });
    if (faixa === "91-180 dias") return goTitulos({ atrasoMin: "91", atrasoMax: "180" });
    if (faixa === "180+ dias") return goTitulos({ atrasoMin: "181" });
  }

  const { data } = useQuery({
    queryKey: ["lara-dashboard", selectedFiliaisKey],
    queryFn: () => getDashboard({ filiais: filiaisApiParam }),
    staleTime: 60_000,
  });

  const { data: alertasInteligentes } = useQuery({
    queryKey: ["lara-alertas-inteligentes", selectedFiliaisKey],
    queryFn: () => getAlertasInteligentes(filiaisApiParam?.[0]),
    staleTime: 120_000,
    refetchInterval: 5 * 60_000,
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
  const ml = (data as (typeof data & { ml?: { bandit_arms: number; propensity_trained: boolean; uplift_trained: boolean; outcomes_processed: number; active_conversations_with_summary: number } }))?.ml;

  return (
    <LaraLayout>
      <PageHeader title="Dashboard" subtitle="Visão geral da operação de cobrança inteligente." />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <CardKPI label="Total em Aberto" value={formatCurrency(kpis?.totalAberto ?? 0)} icon={<DollarSign className="h-4 w-4" />} onClick={() => goTitulos()} />
        <CardKPI label="Clientes c/ Títulos" value={kpis?.clientesAberto ?? 0} icon={<Users className="h-4 w-4" />} onClick={() => navigate("/lara/clientes")} />
        <CardKPI label="Boletos Enviados" value={kpis?.boletoEnviados ?? 0} icon={<FileText className="h-4 w-4" />} onClick={() => navigate("/lara/atendimentos")} />
        <CardKPI label="Interações Hoje" value={kpis?.interacoesHoje ?? 0} icon={<MessageSquare className="h-4 w-4" />} onClick={() => navigate("/lara/atendimentos")} />
        <CardKPI label="Promessas" value={kpis?.promessas ?? 0} icon={<Handshake className="h-4 w-4" />} onClick={() => navigate("/lara/promessas")} />
        <CardKPI label="Opt-outs Ativos" value={kpis?.optouts ?? 0} icon={<ShieldBan className="h-4 w-4" />} onClick={() => navigate("/lara/optout")} />
        <CardKPI label="Na Régua Ativa" value={kpis?.reguaAtiva ?? 0} icon={<Zap className="h-4 w-4" />} onClick={() => navigate("/lara/regua-ativa")} />
        <CardKPI label="Taxa de Resposta" value={`${(kpis?.taxaResposta ?? 0).toFixed(1)}%`} icon={<TrendingUp className="h-4 w-4" />} onClick={() => navigate("/lara/atendimentos")} />
        <CardKPI label="Valor Recuperado" value={formatCurrency(kpis?.valorRecuperado ?? 0)} icon={<DollarSign className="h-4 w-4" />} onClick={() => navigate("/lara/cases")} />
        <CardKPI label="Vencendo Hoje" value={formatCurrency(kpis?.vencendoHoje ?? 0)} icon={<CalendarClock className="h-4 w-4" />} onClick={() => goTitulos({ vencendoHoje: "1" })} />
        <CardKPI label="Vencido > 30 dias" value={formatCurrency(kpis?.vencidoMaisTrintaDias ?? 0)} icon={<AlertTriangle className="h-4 w-4" />} onClick={() => goTitulos({ atrasoMin: "30" })} />
        <CardKPI
          label="Taxa Recuperação"
          value={reguaEtapas.length ? `${(reguaEtapas.reduce((sum, etapa) => sum + etapa.taxa_recuperacao, 0) / reguaEtapas.length).toFixed(1)}%` : "0,0%"}
          icon={<TrendingUp className="h-4 w-4" />}
          onClick={() => navigate("/lara/regua-ativa")}
        />
        <CardKPI label="Classificações IA" value={totalClassificacoes} icon={<Brain className="h-4 w-4" />} onClick={() => navigate("/lara/feedback")} />
        <CardKPI label="Taxa OpenAI" value={`${taxaOpenAi.toFixed(1)}%`} icon={<Bot className="h-4 w-4" />} onClick={() => navigate("/lara/feedback")} />
        <CardKPI label="Fallback Local" value={`${taxaFallback.toFixed(1)}%`} icon={<AlertTriangle className="h-4 w-4" />} onClick={() => navigate("/lara/feedback")} />
        <CardKPI label="Acurácia Estimada IA" value={formatPercent(classificador?.acuracia_estimada_media ?? 0)} icon={<TrendingUp className="h-4 w-4" />} onClick={() => navigate("/lara/feedback")} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-5">
          <h3 className="mb-4 text-sm font-semibold text-foreground">Distribuição por Faixa de Atraso</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={faixaAtrasoData} style={{ cursor: "pointer" }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,88%)" />
              <XAxis dataKey="faixa" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `R$${(value / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Bar dataKey="valor" fill="hsl(215,80%,28%)" radius={[4, 4, 0, 0]} onClick={(data: { faixa: string }) => handleFaixaClick(data.faixa)} />
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
                <div key={cliente.codcli} className="rounded-md px-3 py-2 hover:bg-muted/50 border border-transparent hover:border-border/50 transition-colors cursor-pointer" onClick={() => navigate(`/lara/clientes/${cliente.codcli}`)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="w-4 text-xs font-mono text-muted-foreground mt-0.5 shrink-0">{index + 1}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{cliente.cliente}</p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                          {cliente.filial && (
                            <span className="text-[10px] text-muted-foreground">{cliente.filial}</span>
                          )}
                          <span className="text-[10px] text-muted-foreground">{cliente.qtd_titulos} título{cliente.qtd_titulos !== 1 ? 's' : ''}</span>
                          {cliente.titulo_mais_antigo && (
                            <span className="text-[10px] text-amber-600">venc. desde {cliente.titulo_mais_antigo}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-sm font-bold text-foreground">{formatCurrency(cliente.total_aberto)}</span>
                      <div className="flex items-center gap-1">
                        <EtapaReguaBadge etapa={cliente.etapa_regua} />
                        <RiskBadge risk={cliente.risco} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Alertas Operacionais</h3>
          {alertas.length === 0 ? (
            <AlertCard type="info" title="Sem alertas no momento" description="Não há alertas críticos registrados." />
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

      {/* Inteligência Adaptativa */}
      <div className="mb-6 rounded-lg border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Cpu className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Inteligência Adaptativa</h3>
          <span className="ml-auto text-[10px] text-muted-foreground uppercase tracking-wide">Módulos ML ativos</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="rounded-md border bg-muted/20 p-3 flex items-start gap-3">
            <FlaskConical className="h-4 w-4 text-violet-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Bandit Engine</p>
              <p className="text-sm font-bold text-foreground">{ml?.bandit_arms ?? '—'} <span className="text-xs font-normal text-muted-foreground">braços</span></p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Thompson Sampling ativo</p>
            </div>
          </div>
          <div className="rounded-md border bg-muted/20 p-3 flex items-start gap-3">
            <Target className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Propensão</p>
              <p className="text-sm font-bold text-foreground">{ml?.propensity_trained ? 'Treinado' : 'Aguardando'}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Regressão logística online</p>
            </div>
          </div>
          <div className="rounded-md border bg-muted/20 p-3 flex items-start gap-3">
            <TrendingUp className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Uplift</p>
              <p className="text-sm font-bold text-foreground">{ml?.uplift_trained ? 'Treinado' : 'Aguardando'}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">T-Learner causal</p>
            </div>
          </div>
          <div className="rounded-md border bg-muted/20 p-3 flex items-start gap-3">
            <Activity className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Outcomes</p>
              <p className="text-sm font-bold text-foreground">{ml?.outcomes_processed ?? 0}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Sinais processados</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Resumo de Conversa (IA)', value: 'GPT-4o-mini', color: 'text-violet-500', detail: 'Cache 6h ativo' },
            { label: 'Abandono Preditivo', value: 'Sobrevivência', color: 'text-orange-500', detail: 'Análise por etapa × risco' },
            { label: 'Multi-objetivo', value: 'Pareto', color: 'text-teal-500', detail: '4 objetivos balanceados' },
            { label: 'Aprendizado Online', value: 'Tempo real', color: 'text-emerald-500', detail: `${ml?.active_conversations_with_summary ?? 0} convs. com resumo` },
          ].map(item => (
            <div key={item.label} className="rounded-md border bg-muted/10 p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{item.label}</p>
              <p className={`text-sm font-semibold ${item.color}`}>{item.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Alertas Inteligentes em tempo real */}
      {alertasInteligentes && alertasInteligentes.total > 0 && (
        <div className="mb-6 rounded-lg border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">🔔 Alertas Inteligentes</h3>
            <div className="flex items-center gap-2 text-xs">
              {alertasInteligentes.criticos > 0 && (
                <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-red-400">
                  {alertasInteligentes.criticos} crítico{alertasInteligentes.criticos > 1 ? "s" : ""}
                </span>
              )}
              {alertasInteligentes.avisos > 0 && (
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-400">
                  {alertasInteligentes.avisos} aviso{alertasInteligentes.avisos > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {alertasInteligentes.alertas.map((a, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 rounded-lg border p-3 ${
                  a.tipo === "critico"
                    ? "border-red-500/30 bg-red-500/10"
                    : a.tipo === "aviso"
                    ? "border-amber-500/30 bg-amber-500/10"
                    : "border-blue-500/30 bg-blue-500/10"
                }`}
              >
                <span className="text-lg">
                  {a.tipo === "critico" ? "🚨" : a.tipo === "aviso" ? "⚠️" : "ℹ️"}
                </span>
                <div>
                  <p className={`text-sm font-semibold ${
                    a.tipo === "critico" ? "text-red-400" : a.tipo === "aviso" ? "text-amber-400" : "text-blue-400"
                  }`}>{a.titulo}</p>
                  <p className="text-xs text-muted-foreground">{a.descricao}</p>
                  {a.valor != null && (
                    <p className="mt-1 text-xs font-medium text-foreground">{formatCurrency(a.valor)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </LaraLayout>
  );
}
