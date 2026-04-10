import { Building2, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useLaraFiliaisFilter } from "@/contexts/LaraFiliaisContext";

function formatFilialLabel(value: string): string {
  const normalized = String(value ?? "").trim();
  return normalized || "-";
}

type FilialGlobalFilterProps = {
  className?: string;
};

export function FilialGlobalFilter({ className }: FilialGlobalFilterProps) {
  const {
    filiaisDisponiveis,
    selectedFiliais,
    summaryLabel,
    isLoading,
    toggleFilial,
    clearSelection,
  } = useLaraFiliaisFilter();

  const allSelected = selectedFiliais.length === 0;
  const selectedSet = new Set(selectedFiliais);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("h-8 min-w-[220px] justify-between text-xs font-normal", className)}
          disabled={isLoading}
        >
          <span className="flex items-center gap-2 truncate">
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{isLoading ? "Carregando filiais..." : summaryLabel}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[280px] p-0">
        <div className="border-b px-3 py-2">
          <p className="text-xs font-semibold text-foreground">Filtro Global de Filial</p>
          <p className="text-[11px] text-muted-foreground">
            Se nenhuma filial estiver marcada, o sistema considera todas.
          </p>
        </div>

        <div className="px-2 py-1.5">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
            onClick={clearSelection}
          >
            <Checkbox checked={allSelected} />
            <span className="font-medium">Todas as filiais</span>
            {allSelected && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
          </button>
        </div>

        <ScrollArea className="max-h-64 px-2 pb-2">
          {filiaisDisponiveis.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">Nenhuma filial disponivel.</div>
          ) : (
            filiaisDisponiveis.map((filial) => (
              <button
                type="button"
                key={filial}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                onClick={() => toggleFilial(filial)}
              >
                <Checkbox checked={selectedSet.has(filial)} />
                <span>{formatFilialLabel(filial)}</span>
              </button>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
