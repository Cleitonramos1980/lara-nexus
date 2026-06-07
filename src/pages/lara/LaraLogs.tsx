import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  CheckCircle,
  MessageSquare,
  ScrollText,
  ShieldBan,
  XCircle,
} from "lucide-react";
import { LaraLayout } from "@/components/lara/LaraLayout";
import { PageHeader } from "@/components/lara/PageHeader";
import { CardKPI } from "@/components/lara/CardKPI";
import { SeverityBadge } from "@/components/lara/SeverityBadge";
import { EmptyState } from "@/components/lara/EmptyState";
import { LaraSensitiveText } from "@/components/lara/LaraSensitiveText";
import { maskSensitiveText } from "@/components/lara/sensitive";
import { getLogs, getAiLogs, type AiLogItem } from "@/services/laraApi";
import { useLaraFiliaisFilter } from "@/contexts/LaraFiliaisContext";

type Tab = "todos" | "mensagens" | "ai" | "casos";

function statusColor(status: string) {
  if (status === "processado" || status === "enviado") return "text-emerald-600";
  if (status === "fallback_local") return "text-amber-500";
  if (status === "erro") return "text-red-500";
  return "text-muted-foreground";
}

function AiLogTable({ logs }: { logs: AiLogItem[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (logs.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <Bot className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">Nenhuma chamada ao LLM registrada ainda.</p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Os registros aparecem aqui após o primeiro inbound de WhatsApp chegar ao backend.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {logs.map((log) => {
        const isOpen = expanded === log.id;
        const isOk = log.status === "processado" && !log.erro;
        const isFallback = log.status === "fallback_local" || log.provider === "fallback";
        const isError = log.status === "erro" || !!log.erro;

        return (
          <div
            key={log.id}
            className="rounded-lg border bg-card transition-colors hover:border-primary/30"
          >
            <button
              className="flex w-full items-start gap-3 p-3 text-left"
              onClick={() => setExpanded(isOpen ? null : log.id)}
            >
              <div className="mt-0.5 shrink-0">
                {isError ? (
                  <XCircle className="h-4 w-4 text-red-500" />
                ) : isFallback ? (
                  <ShieldBan className="h-4 w-4 text-amber-500" />
                ) : (
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {log.created_at?.slice(0, 19).replace("T", " ")}
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                    {log.tipo}
                  </span>
                  {log.intent && (
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      intent: {log.intent}
                    </span>
                  )}
                  {log.action && (
                    <span className="rounded bg-purple-50 px-1.5 py-0.5 text-xs text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                      ação: {log.action}
                    </span>
                  )}
                  <span className={`ml-auto text-xs font-medium ${statusColor(log.status)}`}>
                    {isFallback ? "fallback local" : log.status}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {log.message_preview
                    ? `"${log.message_preview}"`
                    : log.erro
                    ? `Erro: ${log.erro}`
                    : "sem preview"}
                </p>
              </div>
            </button>

            {isOpen && (
              <div className="border-t bg-muted/20 px-4 py-3 text-xs space-y-2">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                  <div><span className="font-medium text-muted-foreground">Modelo:</span> {log.model}</div>
                  <div><span className="font-medium text-muted-foreground">Provider:</span> {log.provider}</div>
                  {log.total != null && (
                    <div>
                      <span className="font-medium text-muted-foreground">Total R$:</span>{" "}
                      {Number(log.total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </div>
                  )}
                  {log.titulos != null && (
                    <div><span className="font-medium text-muted-foreground">Títulos:</span> {log.titulos}</div>
                  )}
                  {log.request_id && (
                    <div className="col-span-2">
                      <span className="font-medium text-muted-foreground">Request ID:</span>{" "}
                      <span className="font-mono">{log.request_id}</span>
                    </div>
                  )}
                  {log.erro && (
                    <div className="col-span-3 text-red-600">
                      <span className="font-medium">Erro:</span> {log.erro}
                    </div>
                  )}
                </div>
                {log.message_preview && (
                  <div className="rounded border bg-card p-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Resposta gerada pelo LLM
                    </p>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">{log.message_preview}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function LaraLogs() {
  const [tab, setTab] = useState<Tab>("todos");
  const [search, setSearch] = useState("");
  const { filiaisApiParam, selectedFiliaisKey } = useLaraFiliaisFilter();

  const { data: allLogs } = useQuery({
    queryKey: ["lara-logs", selectedFiliaisKey],
    queryFn: () => getLogs({ filiais: filiaisApiParam, limit: 2000 }),
    staleTime: 20_000,
  });

  const { data: aiLogs } = useQuery({
    queryKey: ["lara-ai-logs"],
    queryFn: () => getAiLogs(300),
    staleTime: 30_000,
  });

  const logs = allLogs ?? [];
  const aiLogsData = aiLogs ?? [];

  const eventosHoje = logs.length;
  const falhasEnvio = logs.filter((l) => l.severidade === "erro").length;
  const sucessos = logs.filter((l) => l.severidade === "sucesso").length;
  const aiAtivadas = aiLogsData.filter((l) => l.provider === "openai").length;

  const normalizedSearch = search.toLowerCase();

  const logsByTab = (() => {
    let base = logs;
    if (tab === "mensagens") base = logs.filter((l) => l.modulo !== "Cases" && l.origem !== "integração");
    if (tab === "casos") base = logs.filter((l) => l.modulo === "Cases");
    return base.filter(
      (l) =>
        !search ||
        l.cliente.toLowerCase().includes(normalizedSearch) ||
        l.tipo.toLowerCase().includes(normalizedSearch) ||
        maskSensitiveText(l.mensagem).toLowerCase().includes(normalizedSearch) ||
        l.codcli.includes(search),
    );
  })();

  const aiLogFiltered = aiLogsData.filter(
    (l) =>
      !search ||
      (l.intent ?? "").includes(normalizedSearch) ||
      (l.action ?? "").includes(normalizedSearch) ||
      (l.message_preview ?? "").toLowerCase().includes(normalizedSearch) ||
      (l.tipo ?? "").includes(normalizedSearch),
  );

  const tabs: { key: Tab; label: string; count: number; icon: React.ReactNode }[] = [
    { key: "todos", label: "Todos", count: logs.length, icon: <ScrollText className="h-3.5 w-3.5" /> },
    { key: "mensagens", label: "Mensagens", count: logs.filter((l) => l.modulo !== "Cases" && l.origem !== "integração").length, icon: <MessageSquare className="h-3.5 w-3.5" /> },
    { key: "ai", label: "IA / LLM", count: aiLogsData.length, icon: <Bot className="h-3.5 w-3.5" /> },
    { key: "casos", label: "Casos", count: logs.filter((l) => l.modulo === "Cases").length, icon: <ShieldBan className="h-3.5 w-3.5" /> },
  ];

  return (
    <LaraLayout>
      <PageHeader
        title="Logs e Auditoria"
        subtitle="Rastreabilidade de ações, eventos, integrações e decisões da Lara."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <CardKPI label="Total Eventos" value={eventosHoje} icon={<ScrollText className="h-4 w-4" />} />
        <CardKPI label="Sucessos" value={sucessos} icon={<CheckCircle className="h-4 w-4" />} />
        <CardKPI label="Falhas" value={falhasEnvio} icon={<XCircle className="h-4 w-4" />} />
        <CardKPI label="LLM Ativadas" value={aiAtivadas} icon={<Bot className="h-4 w-4" />} />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-lg border bg-muted/30 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
              tab === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon}
            {t.label}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab === t.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tab === "ai" ? "Buscar por intent, ação, preview da resposta..." : "Buscar por tipo, cliente, mensagem..."}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {/* IA Tab */}
      {tab === "ai" ? (
        <div>
          {aiLogsData.length > 0 && (
            <div className="mb-3 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
              <Bot className="h-4 w-4 shrink-0" />
              <span>
                <strong>{aiLogsData.filter((l) => l.provider === "openai").length}</strong> respostas geradas pelo GPT-4o-mini •{" "}
                <strong>{aiLogsData.filter((l) => l.provider === "fallback").length}</strong> usaram fallback local •{" "}
                <strong>{aiLogsData.filter((l) => l.status === "erro").length}</strong> erros
              </span>
            </div>
          )}
          <AiLogTable logs={aiLogFiltered} />
        </div>
      ) : (
        /* Tabela padrão */
        logsByTab.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {["Data/Hora", "Sev.", "Tipo", "Módulo", "Cliente", "Codcli", "Etapa", "Mensagem", "Status"].map((h) => (
                      <th key={h} className="px-2 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logsByTab.map((log) => (
                    <tr key={log.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="whitespace-nowrap px-2 py-2.5 text-xs">{log.data_hora}</td>
                      <td className="px-2 py-2.5"><SeverityBadge severity={log.severidade} /></td>
                      <td className="px-2 py-2.5 text-xs font-medium">{log.tipo}</td>
                      <td className="px-2 py-2.5 text-xs">{log.modulo}</td>
                      <td className="max-w-[140px] truncate px-2 py-2.5 text-xs">{log.cliente}</td>
                      <td className="px-2 py-2.5 font-mono text-xs">{log.codcli}</td>
                      <td className="px-2 py-2.5 text-xs">{log.etapa}</td>
                      <td className="max-w-[250px] truncate px-2 py-2.5 text-xs text-muted-foreground">
                        <LaraSensitiveText value={log.mensagem} />
                      </td>
                      <td className="px-2 py-2.5 text-xs">{log.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </LaraLayout>
  );
}
