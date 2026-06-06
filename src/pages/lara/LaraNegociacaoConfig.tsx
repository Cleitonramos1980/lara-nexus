import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileClock,
  FlaskConical,
  HandCoins,
  LockKeyhole,
  Pencil,
  Percent,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { LaraLayout } from "@/components/lara/LaraLayout";
import { LaraPageContainer } from "@/components/lara/LaraPageContainer";
import { PageHeader } from "@/components/lara/PageHeader";
import { CardKPI } from "@/components/lara/CardKPI";
import { EmptyState } from "@/components/lara/EmptyState";
import { StatusBadge } from "@/components/lara/StatusBadge";
import { TableSkeleton } from "@/components/lara/TableSkeleton";
import { DisabledTooltip } from "@/components/lara/LaraPermissionGate";
import { canAccess, canAction } from "@/components/lara/permissions";
import { LaraRestrictedState } from "@/components/lara/LaraRestrictedState";
import {
  formatIntegerBR,
  formatMoneyBRL,
  formatPercentBR,
} from "@/components/lara/formatters";
import {
  getPoliticasNegociacao,
  salvarPoliticaNegociacao,
  simularNegociacao,
  getNegociacaoHistorico,
  type NegociacaoHistoricoItem,
} from "@/services/laraApi";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Politica = {
  etapa_regua: string;
  desconto_maximo_pct: number;
  parcelas_maximas: number;
  entrada_minima_pct: number;
  ativo: boolean;
};

type PoliticaForm = Omit<Politica, "etapa_regua">;

type SimulacaoResult = {
  pode_negociar: boolean;
  motivo_bloqueio?: string;
  mensagem_apresentacao?: string;
  propostas?: Array<{
    tipo: string;
    desconto_pct: number;
    valor_original: number;
    valor_com_desconto: number;
    entrada: number;
    parcelas: number;
    valor_parcela: number;
    mensagem_oferta: string;
  }>;
};

type PendingSave = {
  etapa: string;
  before?: Politica;
  after: PoliticaForm;
};

const ROTINA = "LARA_NEGOCIACAO";
const ETAPAS = ["D-3", "D0", "D+3", "D+7", "D+15", "D+30"];
const DEFAULT_FORM: PoliticaForm = {
  desconto_maximo_pct: 5,
  parcelas_maximas: 3,
  entrada_minima_pct: 25,
  ativo: true,
};

const etapaMeta: Record<string, { descricao: string; perfil: string; atraso: string }> = {
  "D-3": { descricao: "Preventivo antes do vencimento", perfil: "Cliente em dia", atraso: "A vencer" },
  D0: { descricao: "Vencimento no dia", perfil: "Cliente em acompanhamento", atraso: "0 dia" },
  "D+3": { descricao: "Início de atraso", perfil: "Risco baixo/médio", atraso: "1 a 3 dias" },
  "D+7": { descricao: "Atraso inicial consolidado", perfil: "Risco médio", atraso: "4 a 7 dias" },
  "D+15": { descricao: "Atraso relevante", perfil: "Risco alto", atraso: "8 a 15 dias" },
  "D+30": { descricao: "Atraso crítico", perfil: "Risco crítico", atraso: "30+ dias" },
};

function normalizePolitica(raw: Politica): Politica {
  return {
    etapa_regua: raw.etapa_regua,
    desconto_maximo_pct: Number(raw.desconto_maximo_pct ?? 0),
    parcelas_maximas: Number(raw.parcelas_maximas ?? 1),
    entrada_minima_pct: Number(raw.entrada_minima_pct ?? 0),
    ativo: raw.ativo !== false,
  };
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fieldChangeSummary(before: Politica | undefined, after: PoliticaForm) {
  const rows = [
    {
      label: "Desconto máximo",
      before: before ? formatPercentBR(before.desconto_maximo_pct) : "Não configurado",
      after: formatPercentBR(after.desconto_maximo_pct),
    },
    {
      label: "Parcelamento máximo",
      before: before ? `${formatIntegerBR(before.parcelas_maximas)} parcelas` : "Não configurado",
      after: `${formatIntegerBR(after.parcelas_maximas)} parcelas`,
    },
    {
      label: "Entrada mínima",
      before: before ? formatPercentBR(before.entrada_minima_pct) : "Não configurado",
      after: formatPercentBR(after.entrada_minima_pct),
    },
    {
      label: "Status",
      before: before ? (before.ativo ? "Ativo" : "Inativo") : "Não configurado",
      after: after.ativo ? "Ativo" : "Inativo",
    },
  ];

  return rows.filter((row) => row.before !== row.after);
}

export default function LaraNegociacaoConfig() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("politicas");
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<PoliticaForm>(DEFAULT_FORM);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [codcliSim, setCodcliSim] = useState("");
  const [duplicatasSim, setDuplicatasSim] = useState("");
  const [simulacao, setSimulacao] = useState<SimulacaoResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const hasRoutineAccess = canAccess(ROTINA);
  const canEdit = canAction(ROTINA, "EDITAR");
  const canAlterDiscount = canAction(ROTINA, "ALTERAR_DESCONTO");
  const canAlterInstallments = canAction(ROTINA, "ALTERAR_PARCELAMENTO");
  const canAlterValidity = canAction(ROTINA, "ALTERAR_VALIDADE");
  const canSave = canAction(ROTINA, "SALVAR_PARAMETROS");
  const canTestRule = canAction(ROTINA, "TESTAR_REGRA");
  const readOnly = !canEdit;

  const politicasQuery = useQuery({
    queryKey: ["lara-negociacao-politicas"],
    queryFn: getPoliticasNegociacao,
    staleTime: 60_000,
  });

  const politicas = useMemo(
    () => (politicasQuery.data ?? []).map((item) => normalizePolitica(item as Politica)),
    [politicasQuery.data],
  );

  const politicasMap = useMemo(() => new Map(politicas.map((p) => [p.etapa_regua, p])), [politicas]);
  const configuredEtapas = ETAPAS.filter((etapa) => politicasMap.has(etapa));
  const activePolicies = politicas.filter((p) => p.ativo);
  const maxParcelas = politicas.length ? Math.max(...politicas.map((p) => p.parcelas_maximas)) : 0;
  const avgDesconto = average(politicas.map((p) => p.desconto_maximo_pct));
  const avgEntrada = average(politicas.map((p) => p.entrada_minima_pct));

  const historicoQuery = useQuery({
    queryKey: ["lara-negociacao-historico"],
    queryFn: () => getNegociacaoHistorico({ limit: 200 }),
    staleTime: 60_000,
    enabled: activeTab === "historico",
  });

  const saveMutation = useMutation({
    mutationFn: (payload: PendingSave) => salvarPoliticaNegociacao(payload.etapa, payload.after),
    onSuccess: (_data, payload) => {
      queryClient.setQueryData<Politica[]>(["lara-negociacao-politicas"], (current = []) => {
        const exists = current.some((item) => item.etapa_regua === payload.etapa);
        if (exists) {
          return current.map((item) =>
            item.etapa_regua === payload.etapa ? { ...item, ...payload.after } : item,
          );
        }
        return [...current, { etapa_regua: payload.etapa, ...payload.after }];
      });
      setPendingSave(null);
      setEditando(null);
      setActionError(null);
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Falha ao salvar política de negociação.");
    },
  });

  const simMutation = useMutation({
    mutationFn: async () => {
      const codcli = Number(codcliSim);
      const duplicatas = duplicatasSim
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      return simularNegociacao(codcli, duplicatas.length ? duplicatas : undefined);
    },
    onSuccess: (data) => {
      setSimulacao(data);
      setActionError(null);
    },
    onError: (error) => {
      setSimulacao({
        pode_negociar: false,
        motivo_bloqueio:
          error instanceof Error ? error.message : "Erro ao simular. Verifique o código do cliente.",
      });
    },
  });

  function abrirEdicao(etapa: string) {
    const politica = politicasMap.get(etapa);
    setForm(
      politica
        ? {
            desconto_maximo_pct: politica.desconto_maximo_pct,
            parcelas_maximas: politica.parcelas_maximas,
            entrada_minima_pct: politica.entrada_minima_pct,
            ativo: politica.ativo,
          }
        : DEFAULT_FORM,
    );
    setEditando(etapa);
  }

  function solicitarConfirmacaoSalvar() {
    if (!editando) return;
    setPendingSave({
      etapa: editando,
      before: politicasMap.get(editando),
      after: form,
    });
  }

  function atualizarCampo<K extends keyof PoliticaForm>(field: K, value: PoliticaForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function executarSimulacao() {
    if (!codcliSim || Number.isNaN(Number(codcliSim))) return;
    setSimulacao(null);
    simMutation.mutate();
  }

  const headerActions = (
    <>
      <Button size="sm" variant="outline" onClick={() => setActiveTab("simulador")} disabled={!canTestRule}>
        <FlaskConical className="mr-2 h-4 w-4" />
        Testar regra
      </Button>
      <Button size="sm" variant="outline" onClick={() => setActiveTab("historico")}>
        <FileClock className="mr-2 h-4 w-4" />
        Ver logs
      </Button>
    </>
  );

  if (!hasRoutineAccess) {
    return (
      <LaraLayout>
        <LaraPageContainer>
          <PageHeader
            title="Negociação"
            subtitle="Políticas de desconto, parcelamento, entrada mínima, alçadas e validade das propostas."
          />
          <LaraRestrictedState description="Seu perfil não possui acesso à rotina LARA_NEGOCIACAO." />
        </LaraPageContainer>
      </LaraLayout>
    );
  }

  return (
    <LaraLayout>
      <LaraPageContainer>
        <PageHeader
          title="Negociação"
          subtitle="Políticas de desconto, parcelamento, entrada mínima, alçadas e validade das propostas."
          actions={headerActions}
        />

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <CardKPI
            label="Políticas ativas"
            value={`${formatIntegerBR(activePolicies.length)}/${formatIntegerBR(ETAPAS.length)}`}
            icon={<ShieldCheck className="h-4 w-4" />}
          />
          <CardKPI
            label="Desconto médio"
            value={politicas.length ? formatPercentBR(avgDesconto) : "-"}
            icon={<Percent className="h-4 w-4" />}
          />
          <CardKPI
            label="Parcelamento máx."
            value={maxParcelas ? `${formatIntegerBR(maxParcelas)}x` : "-"}
            icon={<CalendarClock className="h-4 w-4" />}
          />
          <CardKPI
            label="Entrada média"
            value={politicas.length ? formatPercentBR(avgEntrada) : "-"}
            icon={<HandCoins className="h-4 w-4" />}
          />
        </div>

        {actionError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Falha na operação</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}

        <Alert>
          <LockKeyhole className="h-4 w-4" />
          <AlertTitle>Rotina financeira sensível</AlertTitle>
          <AlertDescription>
            Alterações em desconto, parcelamento, entrada mínima, validade ou status da política exigem confirmação
            antes de gravar e continuam sujeitas às permissões e validações definitivas do backend.
          </AlertDescription>
        </Alert>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-3 lg:grid-cols-6">
            <TabsTrigger value="politicas">Políticas</TabsTrigger>
            <TabsTrigger value="descontos">Descontos</TabsTrigger>
            <TabsTrigger value="parcelamento">Parcelamento</TabsTrigger>
            <TabsTrigger value="alcadas">Alçadas</TabsTrigger>
            <TabsTrigger value="simulador">Simulador</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="politicas" className="space-y-4">
            {politicasQuery.isError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Não foi possível carregar as políticas</AlertTitle>
                <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>Verifique a API de negociação e tente novamente.</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => politicasQuery.refetch()}
                    className="w-fit"
                  >
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Recarregar
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {politicasQuery.isLoading ? (
              <TableSkeleton rows={6} cols={10} />
            ) : (
              <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
                <Card className="overflow-hidden">
                  <CardHeader className="border-b bg-muted/20 p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <CardTitle className="text-base">Políticas por etapa da régua</CardTitle>
                        <CardDescription>
                          Limites cadastrados para a negociação autônoma da Lara.
                        </CardDescription>
                      </div>
                      <Badge variant="secondary" className="w-fit">
                        {formatIntegerBR(configuredEtapas.length)} configuradas
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            {[
                              "Etapa",
                              "Perfil",
                              "Faixa de atraso",
                              "Desconto máx.",
                              "Entrada mín.",
                              "Parcelas",
                              "Validade",
                              "Alçada",
                              "Status",
                              "",
                            ].map((header) => (
                              <th
                                key={header}
                                className="whitespace-nowrap px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                              >
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {ETAPAS.map((etapa) => {
                            const politica = politicasMap.get(etapa);
                            const meta = etapaMeta[etapa];
                            return (
                              <tr key={etapa} className="border-b last:border-0 hover:bg-muted/20">
                                <td className="px-3 py-3">
                                  <div className="flex flex-col">
                                    <span className="font-mono text-xs font-semibold text-foreground">{etapa}</span>
                                    <span className="text-xs text-muted-foreground">{meta.descricao}</span>
                                  </div>
                                </td>
                                <td className="px-3 py-3 text-xs text-muted-foreground">{meta.perfil}</td>
                                <td className="px-3 py-3 text-xs text-muted-foreground">{meta.atraso}</td>
                                <td className="px-3 py-3 text-right font-semibold text-foreground">
                                  {politica ? formatPercentBR(politica.desconto_maximo_pct) : "-"}
                                </td>
                                <td className="px-3 py-3 text-right text-foreground">
                                  {politica ? formatPercentBR(politica.entrada_minima_pct) : "-"}
                                </td>
                                <td className="px-3 py-3 text-right text-foreground">
                                  {politica ? `${formatIntegerBR(politica.parcelas_maximas)}x` : "-"}
                                </td>
                                <td className="px-3 py-3 text-xs text-muted-foreground">Não definida</td>
                                <td className="px-3 py-3">
                                  <Badge variant="outline" className="whitespace-nowrap">
                                    Operação
                                  </Badge>
                                </td>
                                <td className="px-3 py-3">
                                  <StatusBadge status={politica?.ativo === false ? "Inativo" : "Ativo"} />
                                </td>
                                <td className="px-3 py-3 text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 gap-2"
                                    onClick={() => abrirEdicao(etapa)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    Editar
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="p-4">
                    <CardTitle className="text-base">
                      {editando ? `Editar política ${editando}` : "Edição de política"}
                    </CardTitle>
                    <CardDescription>
                      Campos ficam somente leitura quando o perfil não possui permissão visual de edição.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 p-4 pt-0">
                    {!editando ? (
                      <EmptyState
                        title="Selecione uma etapa"
                        description="Use a ação Editar na tabela para ajustar desconto, entrada, parcelamento e status."
                      />
                    ) : (
                      <>
                        <div className="grid gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="desconto">Desconto máximo permitido</Label>
                            <Input
                              id="desconto"
                              type="number"
                              min={0}
                              max={100}
                              step={0.5}
                              value={form.desconto_maximo_pct}
                              disabled={readOnly || !canAlterDiscount}
                              onChange={(event) =>
                                atualizarCampo("desconto_maximo_pct", Number(event.target.value))
                              }
                            />
                            <p className="text-xs text-muted-foreground">
                              Exibido como {formatPercentBR(form.desconto_maximo_pct)} na régua.
                            </p>
                          </div>

                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor="entrada">Entrada mínima</Label>
                              <Input
                                id="entrada"
                                type="number"
                                min={0}
                                max={100}
                                step={0.5}
                                value={form.entrada_minima_pct}
                                disabled={readOnly || !canAlterInstallments}
                                onChange={(event) =>
                                  atualizarCampo("entrada_minima_pct", Number(event.target.value))
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="parcelas">Parcelas máximas</Label>
                              <Input
                                id="parcelas"
                                type="number"
                                min={1}
                                max={48}
                                step={1}
                                value={form.parcelas_maximas}
                                disabled={readOnly || !canAlterInstallments}
                                onChange={(event) =>
                                  atualizarCampo("parcelas_maximas", Number(event.target.value))
                                }
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
                            <div>
                              <Label htmlFor="ativo" className="text-sm font-medium">
                                Política ativa
                              </Label>
                              <p className="text-xs text-muted-foreground">
                                Ativar ou inativar impacta ofertas automáticas desta etapa.
                              </p>
                            </div>
                            <Switch
                              id="ativo"
                              checked={form.ativo}
                              disabled={readOnly || !canAlterValidity}
                              onCheckedChange={(checked) => atualizarCampo("ativo", checked)}
                            />
                          </div>
                        </div>

                        <Separator />

                        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                          <Button variant="outline" onClick={() => setEditando(null)}>
                            Cancelar
                          </Button>
                          {canSave ? (
                            <Button onClick={solicitarConfirmacaoSalvar} disabled={saveMutation.isPending}>
                              <Save className="mr-2 h-4 w-4" />
                              Salvar alterações
                            </Button>
                          ) : (
                            <DisabledTooltip message="Seu perfil não possui permissão para salvar parâmetros de negociação.">
                              <Button disabled>
                                <Save className="mr-2 h-4 w-4" />
                                Salvar alterações
                              </Button>
                            </DisabledTooltip>
                          )}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="descontos" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ETAPAS.map((etapa) => {
              const politica = politicasMap.get(etapa);
              const desconto = politica?.desconto_maximo_pct ?? 0;
              return (
                <Card key={etapa}>
                  <CardHeader className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{etapa}</CardTitle>
                        <CardDescription>{etapaMeta[etapa].descricao}</CardDescription>
                      </div>
                      <StatusBadge status={politica?.ativo === false ? "Inativo" : "Ativo"} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4 pt-0">
                    <div className="flex items-end justify-between">
                      <span className="text-sm text-muted-foreground">Desconto máximo</span>
                      <span className="text-2xl font-bold text-foreground">
                        {politica ? formatPercentBR(desconto) : "-"}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.min(Math.max(desconto, 0), 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Regras por filial, faixa de valor e perfil de risco ainda não retornam da API desta tela.
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="parcelamento" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ETAPAS.map((etapa) => {
              const politica = politicasMap.get(etapa);
              return (
                <Card key={etapa}>
                  <CardHeader className="p-4">
                    <CardTitle className="text-base">Parcelamento {etapa}</CardTitle>
                    <CardDescription>{etapaMeta[etapa].atraso}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4 pt-0">
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">Quantidade máxima</p>
                      <p className="text-lg font-semibold text-foreground">
                        {politica ? `${formatIntegerBR(politica.parcelas_maximas)} parcelas` : "-"}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">Entrada mínima</p>
                      <p className="text-lg font-semibold text-foreground">
                        {politica ? formatPercentBR(politica.entrada_minima_pct) : "-"}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Juros, multa e valor mínimo de parcela devem permanecer validados pelo backend/WinThor quando disponíveis.
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="alcadas" className="space-y-4">
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>Alçadas baseadas nas políticas ativas</AlertTitle>
              <AlertDescription>
                Os limites abaixo refletem os parâmetros configurados por etapa. Para alterar, use a aba Políticas.
              </AlertDescription>
            </Alert>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {ETAPAS.map((etapa) => {
                const politica = politicasMap.get(etapa);
                const meta = etapaMeta[etapa];
                return (
                  <Card key={etapa}>
                    <CardHeader className="p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <CardTitle className="text-base font-mono">{etapa}</CardTitle>
                          <CardDescription className="text-xs">{meta.descricao}</CardDescription>
                        </div>
                        <StatusBadge status={politica?.ativo === false ? "Inativo" : "Ativo"} />
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-2">
                      {!politica ? (
                        <p className="text-xs text-muted-foreground">Política não configurada.</p>
                      ) : (
                        <>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Desconto máx. autorizado</span>
                            <span className="font-semibold">{formatPercentBR(politica.desconto_maximo_pct)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Parcelamento máx.</span>
                            <span className="font-semibold">{formatIntegerBR(politica.parcelas_maximas)}x</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Entrada mínima</span>
                            <span className="font-semibold">{formatPercentBR(politica.entrada_minima_pct)}</span>
                          </div>
                          <div className="flex justify-between text-sm border-t pt-2 mt-2">
                            <span className="text-muted-foreground">Alçada</span>
                            <Badge variant="outline">Operação</Badge>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="simulador">
            <div className="grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
              <Card>
                <CardHeader className="p-4">
                  <CardTitle className="text-base">Simular regra</CardTitle>
                  <CardDescription>
                    Simulação segura: não executa baixa, não gera acordo real e não altera financeiro.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 p-4 pt-0">
                  <div className="space-y-2">
                    <Label htmlFor="codcli">Código do cliente</Label>
                    <Input
                      id="codcli"
                      inputMode="numeric"
                      placeholder="Ex.: 10234"
                      value={codcliSim}
                      onChange={(event) => setCodcliSim(event.target.value)}
                      disabled={!canTestRule || simMutation.isPending}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="duplicatas">Duplicatas específicas</Label>
                    <Input
                      id="duplicatas"
                      placeholder="Opcional, separadas por vírgula"
                      value={duplicatasSim}
                      onChange={(event) => setDuplicatasSim(event.target.value)}
                      disabled={!canTestRule || simMutation.isPending}
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={executarSimulacao}
                    disabled={!canTestRule || simMutation.isPending || !codcliSim}
                  >
                    <FlaskConical className="mr-2 h-4 w-4" />
                    {simMutation.isPending ? "Simulando..." : "Testar regra"}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4">
                  <CardTitle className="text-base">Resultado da simulação</CardTitle>
                  <CardDescription>
                    Valores exibidos usam retorno real da API de simulação quando disponível.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  {simMutation.isPending ? (
                    <TableSkeleton rows={3} cols={5} />
                  ) : !simulacao ? (
                    <EmptyState
                      title="Nenhuma simulação executada"
                      description="Informe um cliente e teste a regra sem gerar proposta real."
                    />
                  ) : !simulacao.pode_negociar ? (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Negociação bloqueada</AlertTitle>
                      <AlertDescription>
                        {simulacao.motivo_bloqueio ?? "A política atual não permite negociação para este cliente."}
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <div className="space-y-4">
                      {simulacao.mensagem_apresentacao && (
                        <Alert>
                          <CheckCircle2 className="h-4 w-4" />
                          <AlertTitle>Mensagem sugerida</AlertTitle>
                          <AlertDescription className="whitespace-pre-line">
                            {simulacao.mensagem_apresentacao}
                          </AlertDescription>
                        </Alert>
                      )}
                      <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/30">
                              {["Tipo", "Desconto", "Original", "Com desconto", "Entrada", "Parcela"].map((header) => (
                                <th
                                  key={header}
                                  className="whitespace-nowrap px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                                >
                                  {header}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(simulacao.propostas ?? []).map((proposta, index) => (
                              <tr key={`${proposta.tipo}-${index}`} className="border-b last:border-0">
                                <td className="px-3 py-3 font-medium">
                                  {proposta.tipo === "avista" ? "À vista" : `${proposta.parcelas}x parcelado`}
                                </td>
                                <td className="px-3 py-3 text-right">{formatPercentBR(proposta.desconto_pct)}</td>
                                <td className="px-3 py-3 text-right">{formatMoneyBRL(proposta.valor_original)}</td>
                                <td className="px-3 py-3 text-right font-semibold">
                                  {formatMoneyBRL(proposta.valor_com_desconto)}
                                </td>
                                <td className="px-3 py-3 text-right">{formatMoneyBRL(proposta.entrada)}</td>
                                <td className="px-3 py-3 text-right">{formatMoneyBRL(proposta.valor_parcela)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="historico">
            <Card className="overflow-hidden">
              <CardHeader className="border-b bg-muted/20 p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-base">Histórico de negociações</CardTitle>
                    <CardDescription>Registros de acordos e negociações realizadas pela Lara.</CardDescription>
                  </div>
                  {historicoQuery.data && (
                    <Badge variant="secondary" className="w-fit">
                      {formatIntegerBR(historicoQuery.data.length)} registros
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {historicoQuery.isLoading ? (
                  <div className="p-4"><TableSkeleton rows={5} cols={6} /></div>
                ) : historicoQuery.isError ? (
                  <div className="p-4">
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Erro ao carregar histórico</AlertTitle>
                      <AlertDescription className="flex items-center gap-3">
                        <span>Falha na API de negociação.</span>
                        <Button size="sm" variant="outline" onClick={() => historicoQuery.refetch()}>
                          <RefreshCw className="mr-2 h-3.5 w-3.5" />
                          Tentar novamente
                        </Button>
                      </AlertDescription>
                    </Alert>
                  </div>
                ) : !historicoQuery.data?.length ? (
                  <div className="p-4">
                    <EmptyState
                      title="Nenhuma negociação registrada"
                      description="As negociações realizadas pela Lara aparecerão aqui assim que forem processadas."
                    />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          {["Data", "CODCLI", "Duplicata", "Tipo", "Valor original", "Valor negociado", "Status"].map((h) => (
                            <th key={h} className="whitespace-nowrap px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(historicoQuery.data as NegociacaoHistoricoItem[]).map((item) => (
                          <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20">
                            <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                              {item.created_at ? new Date(item.created_at).toLocaleString("pt-BR") : "-"}
                            </td>
                            <td className="px-3 py-3 font-mono text-xs">{item.codcli || "-"}</td>
                            <td className="px-3 py-3 text-xs">{item.duplicata || "-"}</td>
                            <td className="px-3 py-3 text-xs">{item.tipo_negociacao || "-"}</td>
                            <td className="px-3 py-3 text-right text-xs">
                              {item.valor_original != null ? formatMoneyBRL(item.valor_original) : "-"}
                            </td>
                            <td className="px-3 py-3 text-right text-xs font-semibold">
                              {item.valor_negociado != null ? formatMoneyBRL(item.valor_negociado) : "-"}
                            </td>
                            <td className="px-3 py-3">
                              <StatusBadge status={item.status_negociacao ?? "pendente"} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <AlertDialog open={!!pendingSave} onOpenChange={(open) => !open && setPendingSave(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar alteração de política</AlertDialogTitle>
              <AlertDialogDescription>
                Regras de negociação impactam ofertas de cobrança financeira. Revise os campos antes de confirmar.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {pendingSave && (
              <div className="space-y-4 text-sm">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Política</p>
                  <p className="font-semibold text-foreground">{pendingSave.etapa}</p>
                </div>
                <div className="space-y-2">
                  {fieldChangeSummary(pendingSave.before, pendingSave.after).map((row) => (
                    <div key={row.label} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 rounded-lg border p-3">
                      <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
                      <div className="grid gap-1 sm:grid-cols-2">
                        <span className="text-xs text-muted-foreground">Anterior: {row.before}</span>
                        <span className="text-xs font-semibold text-foreground">Novo: {row.after}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Impacto esperado</AlertTitle>
                  <AlertDescription>
                    A alteração passa a orientar as propostas automáticas da etapa selecionada após o backend aceitar a gravação.
                  </AlertDescription>
                </Alert>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={saveMutation.isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  if (pendingSave) saveMutation.mutate(pendingSave);
                }}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "Salvando..." : "Confirmar e salvar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </LaraPageContainer>
    </LaraLayout>
  );
}
