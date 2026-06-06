import { cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  "Aguardando resposta": "bg-amber-100 text-amber-800",
  "Cliente respondeu": "bg-blue-100 text-blue-800",
  "Cliente identificado": "bg-sky-100 text-sky-800",
  "Cliente não identificado": "bg-slate-100 text-slate-700",
  "Boleto enviado": "bg-emerald-100 text-emerald-800",
  "PIX enviado": "bg-teal-100 text-teal-800",
  "Promessa registrada": "bg-violet-100 text-violet-800",
  "Escalado para humano": "bg-orange-100 text-orange-800",
  "Encerrado": "bg-gray-100 text-gray-600",
  "Opt-out ativo": "bg-red-100 text-red-700",
  "Falha operacional": "bg-red-100 text-red-800",
  "Concluído": "bg-emerald-100 text-emerald-800",
  "Parcial": "bg-amber-100 text-amber-800",
  "Processado": "bg-emerald-100 text-emerald-800",
  "Falha": "bg-red-100 text-red-800",
  "Aplicado": "bg-slate-100 text-slate-700",
  "Ativo": "bg-emerald-100 text-emerald-800",
  "Inativo": "bg-slate-100 text-slate-700",
  "Aberto": "bg-blue-100 text-blue-800",
  "Vencido": "bg-red-100 text-red-800",
  "A vencer": "bg-sky-100 text-sky-800",
  "Negociado": "bg-violet-100 text-violet-800",
  "Pago": "bg-emerald-100 text-emerald-800",
  "Baixado": "bg-emerald-100 text-emerald-800",
  "Protestado": "bg-orange-100 text-orange-800",
  "Cancelado": "bg-slate-100 text-slate-700",
  "Pendente": "bg-amber-100 text-amber-800",
  "Executando": "bg-blue-100 text-blue-800",
  "Enviado": "bg-emerald-100 text-emerald-800",
  "Reagendado": "bg-violet-100 text-violet-800",
  "Ignorado": "bg-slate-100 text-slate-700",
  "Bloqueado por opt-out": "bg-red-100 text-red-800",
  "Online": "bg-emerald-100 text-emerald-800",
  "Instável": "bg-amber-100 text-amber-800",
  "Offline": "bg-red-100 text-red-800",
  "Erro": "bg-red-100 text-red-800",
  "Sem configuração": "bg-slate-100 text-slate-700",
  "Em homologação": "bg-blue-100 text-blue-800",
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const colors = statusColors[status] || "bg-gray-100 text-gray-700";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", colors, className)}>
      {status}
    </span>
  );
}
