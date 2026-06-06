import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, ScrollText, ShieldBan, XCircle } from "lucide-react";
import { LaraLayout } from "@/components/lara/LaraLayout";
import { PageHeader } from "@/components/lara/PageHeader";
import { CardKPI } from "@/components/lara/CardKPI";
import { FilterBar } from "@/components/lara/FilterBar";
import { SeverityBadge } from "@/components/lara/SeverityBadge";
import { EmptyState } from "@/components/lara/EmptyState";
import { LaraSensitiveText } from "@/components/lara/LaraSensitiveText";
import { maskSensitiveText } from "@/components/lara/sensitive";
import { getLogs } from "@/services/laraApi";
import { useLaraFiliaisFilter } from "@/contexts/LaraFiliaisContext";

export default function LaraLogs() {
  const [search, setSearch] = useState("");
  const { filiaisApiParam, selectedFiliaisKey } = useLaraFiliaisFilter();

  const { data } = useQuery({
    queryKey: ["lara-logs", selectedFiliaisKey],
    queryFn: () => getLogs({ filiais: filiaisApiParam, limit: 2000 }),
    staleTime: 20_000,
  });

  const logs = data ?? [];

  const eventosHoje = logs.length;
  const falhasEnvio = logs.filter((l) => l.severidade === "erro").length;
  const sucessos = logs.filter((l) => l.severidade === "sucesso").length;
  const bloqueados = logs.filter((l) => l.severidade === "bloqueado").length;
  const normalizedSearch = search.toLowerCase();

  const filtered = logs.filter(
    (l) =>
      !search ||
      l.cliente.toLowerCase().includes(normalizedSearch) ||
      l.tipo.toLowerCase().includes(normalizedSearch) ||
      maskSensitiveText(l.mensagem).toLowerCase().includes(normalizedSearch) ||
      l.codcli.includes(search),
  );

  return (
    <LaraLayout>
      <PageHeader
        title="Logs e Auditoria"
        subtitle="Rastreabilidade de ações, eventos, integrações e decisões da Lara."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <CardKPI label="Eventos Hoje" value={eventosHoje} icon={<ScrollText className="h-4 w-4" />} />
        <CardKPI label="Sucessos" value={sucessos} icon={<CheckCircle className="h-4 w-4" />} />
        <CardKPI label="Falhas" value={falhasEnvio} icon={<XCircle className="h-4 w-4" />} />
        <CardKPI label="Bloqueados" value={bloqueados} icon={<ShieldBan className="h-4 w-4" />} />
      </div>

      <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Buscar por tipo, cliente, mensagem..." />

      {filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  {["Data/Hora", "Severidade", "Tipo", "Módulo", "Cliente", "Codcli", "Etapa", "Mensagem", "Status"].map((header) => (
                    <th key={header} className="px-2 py-3 text-left text-xs font-medium text-muted-foreground">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <tr key={log.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="whitespace-nowrap px-2 py-2.5 text-xs">{log.data_hora}</td>
                    <td className="px-2 py-2.5">
                      <SeverityBadge severity={log.severidade} />
                    </td>
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
      )}
    </LaraLayout>
  );
}
