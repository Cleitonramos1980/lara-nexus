import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MessageSquarePlus,
  Phone,
  RotateCcw,
  Send,
  User,
  X,
} from "lucide-react";
import { LaraLayout } from "@/components/lara/LaraLayout";
import { PageHeader } from "@/components/lara/PageHeader";
import { EmptyState } from "@/components/lara/EmptyState";
import { CardKPI } from "@/components/lara/CardKPI";
import { formatCurrency } from "@/data/lara-mock";
import type { CaseItem, Conversa } from "@/data/lara-mock";
import {
  getCases,
  getClienteConversas,
  getClienteTitulos,
  getCliente,
  updateCaseStatus,
  enviarMensagemHumano,
} from "@/services/laraApi";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Normaliza textos de log internos armazenados no histórico
// Ex: "[uazapi:D0] ..." ou "[template:D+7] ..." → "[D0] ..."
function normalizarTextoMsg(texto: string): string {
  return texto.replace(/^\[(uazapi-pix|uazapi|template):/, "[");
}

const TIPOS_ESCALACAO = new Set([
  "ESCALACAO_HUMANA",
  "OPTOUT_COM_DIVIDA_ATIVA",
  "PAGAMENTO_CONFIRMADO_DESCONHECIDO",
]);

const PRIORIDADE_CORES: Record<string, string> = {
  urgente: "bg-red-100 text-red-700 border-red-200",
  pendente: "bg-amber-100 text-amber-700 border-amber-200",
  em_atendimento: "bg-blue-100 text-blue-700 border-blue-200",
  resolvido: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

const PRIORIDADE_LABEL: Record<string, string> = {
  urgente: "Urgente",
  pendente: "Pendente",
  em_atendimento: "Em atendimento",
  resolvido: "Resolvido",
};

function badgeCase(tipo: string) {
  if (tipo === "ESCALACAO_HUMANA") return "bg-orange-100 text-orange-800";
  if (tipo === "OPTOUT_COM_DIVIDA_ATIVA") return "bg-red-100 text-red-800";
  return "bg-slate-100 text-slate-700";
}

function tipoLabel(tipo: string) {
  if (tipo === "ESCALACAO_HUMANA") return "Escalação";
  if (tipo === "OPTOUT_COM_DIVIDA_ATIVA") return "Opt-out c/ Dívida";
  if (tipo === "PAGAMENTO_CONFIRMADO_DESCONHECIDO") return "Pgto Desconhecido";
  return tipo.replace(/_/g, " ");
}

// ─── Painel de atendimento (lado direito) ─────────────────────────────────────

function PainelAtendimento({
  caseItem,
  onClose,
  onStatusChange,
}: {
  caseItem: CaseItem;
  onClose: () => void;
  onStatusChange: (status: string) => void;
}) {
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  const { data: cliente } = useQuery({
    queryKey: ["cliente", caseItem.codcli],
    queryFn: () => getCliente(caseItem.codcli),
    enabled: !!caseItem.codcli,
    staleTime: 60_000,
  });

  const { data: titulos } = useQuery({
    queryKey: ["titulos-atend", caseItem.codcli],
    queryFn: () => getClienteTitulos(caseItem.codcli),
    enabled: !!caseItem.codcli,
    staleTime: 60_000,
  });

  const { data: conversas, refetch: refetchConversas } = useQuery({
    queryKey: ["conversas-atend", caseItem.wa_id || caseItem.codcli],
    queryFn: () => getClienteConversas(caseItem.codcli),
    enabled: !!caseItem.codcli,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const qc = useQueryClient();

  // Scroll to bottom whenever conversation updates
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [conversas]);

  // Flatten all messages sorted by time
  const todasMensagens = (conversas ?? [])
    .flatMap((c: Conversa) => c.mensagens ?? [])
    .sort((a, b) => a.data_hora.localeCompare(b.data_hora));

  // Extrai etapa da última mensagem da Lara que tenha tag [D...]
  const etapaUltimaMensagem = (() => {
    const laraMessages = [...todasMensagens].reverse().filter((m) => m.remetente === "lara");
    for (const m of laraMessages) {
      const match = m.texto.match(/^\[(?:uazapi-pix:|uazapi:|template:)?([^\]]+)\]/);
      if (match) return match[1];
    }
    return null;
  })();

  const handleEnviar = async () => {
    if (!mensagem.trim() || !caseItem.wa_id) return;
    setEnviando(true);
    setErroEnvio("");
    try {
      await enviarMensagemHumano({
        wa_id: caseItem.wa_id,
        mensagem: mensagem.trim(),
        operador: "Atendente",
        case_id: caseItem.id,
        codcli: caseItem.codcli,
      });
      setMensagem("");
      onStatusChange("em_atendimento");
      await refetchConversas();
      qc.invalidateQueries({ queryKey: ["lara-escalacoes"] });
    } catch {
      setErroEnvio("Falha ao enviar. Verifique a conexão.");
    } finally {
      setEnviando(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleEnviar();
    }
  };

  const totalAberto = (titulos ?? []).reduce((s: number, t: { valor?: number }) => s + (t.valor ?? 0), 0);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
      {/* Header */}
      <div className="flex items-start justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${badgeCase(caseItem.acao)}`}>
              {tipoLabel(caseItem.acao)}
            </span>
            <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${PRIORIDADE_CORES[caseItem.status] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
              {PRIORIDADE_LABEL[caseItem.status] ?? caseItem.status}
            </span>
          </div>
          <h3 className="mt-1 truncate text-sm font-semibold">{caseItem.cliente || "Cliente não identificado"}</h3>
          <p className="text-xs text-muted-foreground">{caseItem.detalhe.slice(0, 120)}</p>
        </div>
        <button onClick={onClose} className="ml-2 shrink-0 rounded p-1 hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Coluna esquerda: dados do cliente + títulos */}
        <div className="w-64 shrink-0 overflow-y-auto border-r bg-muted/20 p-3">
          {/* Dados do cliente */}
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Cliente</p>
          <div className="space-y-1 rounded-lg border bg-card p-2 text-xs">
            <div className="flex items-center gap-1.5">
              <User className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium">{cliente?.cliente ?? caseItem.cliente}</span>
            </div>
            {caseItem.wa_id && (
              <div className="flex items-center gap-1.5">
                <Phone className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono">{caseItem.wa_id}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-1">
              <span className="text-muted-foreground">Codcli:</span>
              <span className="font-mono font-medium">{caseItem.codcli}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Etapa:</span>
              <span className="font-medium">{etapaUltimaMensagem || cliente?.etapa_regua || caseItem.etapa || "-"}</span>
            </div>
            <div className="flex justify-between border-t pt-1">
              <span className="text-muted-foreground">Total aberto:</span>
              <span className="font-semibold text-red-600">{formatCurrency(totalAberto)}</span>
            </div>
          </div>

          {/* Títulos em aberto */}
          <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Títulos em aberto ({titulos?.length ?? 0})
          </p>
          {(titulos ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum título encontrado.</p>
          ) : (
            <div className="space-y-1.5">
              {(titulos ?? []).slice(0, 10).map((t: { id?: string; duplicata?: string; valor?: number; vencimento?: string; dias_atraso?: number }) => (
                <div key={t.id ?? t.duplicata} className="rounded border bg-card p-2 text-xs">
                  <div className="flex justify-between">
                    <span className="font-mono font-medium">{t.duplicata}</span>
                    <span className="font-semibold text-red-600">{formatCurrency(t.valor ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Venc: {t.vencimento ?? "-"}</span>
                    {(t.dias_atraso ?? 0) > 0 && (
                      <span className="text-amber-600">{t.dias_atraso}d atraso</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Ações rápidas */}
          <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ação</p>
          <div className="space-y-1.5">
            {caseItem.status === "resolvido" ? (
              <button
                onClick={() => onStatusChange("pendente")}
                className="w-full rounded border bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
              >
                Reabrir case
              </button>
            ) : (
              <>
                <button
                  onClick={() => onStatusChange("em_atendimento")}
                  className="w-full rounded border bg-blue-50 px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                >
                  Assumir atendimento
                </button>
                <button
                  onClick={() => onStatusChange("resolvido")}
                  className="w-full rounded border bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                >
                  Marcar como resolvido
                </button>
              </>
            )}
          </div>
        </div>

        {/* Coluna direita: histórico de conversa + envio */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Histórico */}
          <div ref={chatRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {todasMensagens.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-xs text-muted-foreground">Nenhuma mensagem no histórico.</p>
              </div>
            ) : (
              todasMensagens.map((msg) => {
                const isLara = msg.remetente === "lara";
                return (
                  <div key={msg.id} className={`flex ${isLara ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-lg px-3 py-2 text-xs shadow-sm ${
                      isLara
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}>
                      <p className="whitespace-pre-wrap leading-relaxed" translate="no">{normalizarTextoMsg(msg.texto)}</p>
                      <p className={`mt-1 text-[10px] ${isLara ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {isLara
                          ? (msg.operador && msg.operador !== "Lara" ? msg.operador : "Lara")
                          : "Cliente"} · {msg.data_hora.slice(11, 16)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Input de envio */}
          <div className="border-t p-3">
            {!caseItem.wa_id && (
              <p className="mb-2 text-[11px] text-amber-600">
                wa_id não identificado — não é possível enviar mensagem.
              </p>
            )}
            {erroEnvio && <p className="mb-1 text-[11px] text-red-500">{erroEnvio}</p>}
            <div className="flex gap-2">
              <textarea
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!caseItem.wa_id || enviando}
                placeholder="Digite sua mensagem... (Enter para enviar)"
                rows={2}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
              />
              <button
                onClick={() => void handleEnviar()}
                disabled={!mensagem.trim() || !caseItem.wa_id || enviando}
                className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40 hover:bg-primary/90"
              >
                <Send className="h-3.5 w-3.5" />
                {enviando ? "..." : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ──────────────────────────────────────────────────────────

type FiltroStatus = "todos" | "urgente" | "pendente" | "em_atendimento" | "resolvido";

const FILTRO_LABEL: Record<FiltroStatus, string> = {
  todos: "Ativos",
  urgente: "Urgente",
  pendente: "Pendente",
  em_atendimento: "Em atend.",
  resolvido: "Resolvidos",
};

function CaseCard({
  c,
  selected,
  onClick,
}: {
  c: CaseItem;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 ${
        selected ? "border-primary bg-primary/5" : "bg-card"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${PRIORIDADE_CORES[c.status] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
          {PRIORIDADE_LABEL[c.status] ?? c.status}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeCase(c.acao)}`}>
          {tipoLabel(c.acao)}
        </span>
      </div>
      <p className="truncate text-sm font-semibold">{c.cliente || "Desconhecido"}</p>
      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{c.detalhe}</p>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{c.etapa || "-"}</span>
        {c.valor_total > 0 && (
          <span className="font-medium text-red-600">{formatCurrency(c.valor_total)}</span>
        )}
        <span>{c.data_hora.slice(0, 16).replace("T", " ")}</span>
      </div>
    </button>
  );
}

export default function LaraAtendimentoHumano() {
  const [selectedCase, setSelectedCase] = useState<CaseItem | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["lara-escalacoes"],
    queryFn: () => getCases(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { mutate: mudarStatus } = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateCaseStatus(id, status, "Atendente"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lara-escalacoes"] });
    },
  });

  const todos = data ?? [];
  const casesEscalados = todos.filter((c) => TIPOS_ESCALACAO.has(c.acao) && c.status !== "resolvido");
  const casesResolvidos = todos.filter((c) => c.status === "resolvido");

  const urgentes = casesEscalados.filter((c) => c.status === "urgente").length;
  const pendentes = casesEscalados.filter((c) => c.status === "pendente").length;
  const emAtendimento = casesEscalados.filter((c) => c.status === "em_atendimento").length;
  const totalAtivos = casesEscalados.length;
  const totalResolvidos = casesResolvidos.length;

  const casesFiltrados = (() => {
    if (filtroStatus === "resolvido") {
      return [...casesResolvidos].sort((a, b) => b.data_hora.localeCompare(a.data_hora));
    }
    const base = filtroStatus === "todos"
      ? casesEscalados
      : casesEscalados.filter((c) => c.status === filtroStatus);
    return base.sort((a, b) => {
      const p: Record<string, number> = { urgente: 0, pendente: 1, em_atendimento: 2 };
      return (p[a.status] ?? 3) - (p[b.status] ?? 3) || b.data_hora.localeCompare(a.data_hora);
    });
  })();

  const handleStatusChange = (status: string) => {
    if (!selectedCase) return;
    mudarStatus({ id: selectedCase.id, status });
    setSelectedCase((prev) => prev ? { ...prev, status } : null);
    if (status === "resolvido" && filtroStatus !== "resolvido") {
      setSelectedCase(null);
    }
  };

  const isResolvidoView = filtroStatus === "resolvido";

  return (
    <LaraLayout>
      <PageHeader
        title="Atendimento Humano"
        subtitle="Cases escalados pela Lara que precisam de atendimento humano. Converse diretamente com o cliente aqui."
      />

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <CardKPI label="Escalados ativos" value={totalAtivos} icon={<MessageSquarePlus className="h-4 w-4" />} />
        <CardKPI label="Urgentes" value={urgentes} icon={<AlertTriangle className="h-4 w-4 text-red-500" />} />
        <CardKPI label="Pendentes" value={pendentes} icon={<Clock className="h-4 w-4 text-amber-500" />} />
        <CardKPI label="Em atendimento" value={emAtendimento} icon={<CheckCircle2 className="h-4 w-4 text-blue-500" />} />
        <CardKPI
          label="Resolvidos"
          value={totalResolvidos}
          icon={<RotateCcw className="h-4 w-4 text-emerald-500" />}
        />
      </div>

      {/* Layout split: lista + painel */}
      <div className={`flex gap-4 ${selectedCase ? "h-[calc(100vh-260px)]" : ""}`}>
        {/* Lista de casos */}
        <div className={`flex flex-col ${selectedCase ? "w-80 shrink-0" : "w-full"}`}>
          {/* Filtros de status */}
          <div className="mb-3 flex gap-1 rounded-lg border bg-muted/30 p-1">
            {(["todos", "urgente", "pendente", "em_atendimento", "resolvido"] as FiltroStatus[]).map((f) => (
              <button
                key={f}
                onClick={() => { setFiltroStatus(f); setSelectedCase(null); }}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  filtroStatus === f
                    ? f === "resolvido"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {FILTRO_LABEL[f]}
              </button>
            ))}
          </div>

          {/* Header da aba resolvidos */}
          {isResolvidoView && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <p className="text-xs text-emerald-700">
                <span className="font-semibold">{totalResolvidos} case(s) resolvido(s).</span>
                {" "}Clique para ver o histórico de conversa.
              </p>
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-2">
            {isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Carregando...</div>
            ) : casesFiltrados.length === 0 ? (
              <EmptyState />
            ) : (
              casesFiltrados.map((c) => (
                <CaseCard
                  key={c.id}
                  c={c}
                  selected={selectedCase?.id === c.id}
                  onClick={() => setSelectedCase(c)}
                />
              ))
            )}
          </div>
        </div>

        {/* Painel de atendimento */}
        {selectedCase && (
          <div className="flex-1 overflow-hidden">
            <PainelAtendimento
              key={selectedCase.id}
              caseItem={selectedCase}
              onClose={() => setSelectedCase(null)}
              onStatusChange={handleStatusChange}
            />
          </div>
        )}
      </div>
    </LaraLayout>
  );
}
