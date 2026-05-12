import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFiliais } from "@/services/laraApi";

const STORAGE_KEY = "lara.filiais.selected";

type LaraFiliaisContextValue = {
  filiaisDisponiveis: string[];
  selectedFiliais: string[];
  selectedFiliaisKey: string;
  filiaisApiParam: string[] | undefined;
  summaryLabel: string;
  isLoading: boolean;
  isError: boolean;
  toggleFilial: (filial: string) => void;
  clearSelection: () => void;
  setSelectedFiliais: (filiais: string[]) => void;
};

const LaraFiliaisContext = createContext<LaraFiliaisContextValue | null>(null);

function normalizeFilial(value: unknown): string {
  return String(value ?? "").trim();
}

function sortFiliais(values: string[]): string[] {
  const unique = Array.from(new Set(values.map(normalizeFilial).filter(Boolean)));
  return unique.sort((a, b) => {
    const aIsNumeric = /^\d+$/.test(a);
    const bIsNumeric = /^\d+$/.test(b);
    if (aIsNumeric && bIsNumeric) return Number(a) - Number(b);
    if (aIsNumeric) return -1;
    if (bIsNumeric) return 1;
    return a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true });
  });
}

function loadInitialSelection(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortFiliais(parsed);
  } catch {
    return [];
  }
}

export function LaraFiliaisProvider({ children }: { children: ReactNode }) {
  const [selectedFiliais, setSelectedFiliaisState] = useState<string[]>(loadInitialSelection);

  const { data: filiaisDisponiveis = [], isLoading, isError } = useQuery({
    queryKey: ["lara-filiais-options"],
    queryFn: async () => sortFiliais(await getFiliais()),
    staleTime: 300_000,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedFiliais));
  }, [selectedFiliais]);

  useEffect(() => {
    if (!filiaisDisponiveis.length || !selectedFiliais.length) return;
    const allowed = new Set(filiaisDisponiveis);
    const sanitized = sortFiliais(selectedFiliais.filter((item) => allowed.has(item)));
    const unchanged = sanitized.length === selectedFiliais.length && sanitized.every((value, index) => value === selectedFiliais[index]);
    if (!unchanged) {
      setSelectedFiliaisState(sanitized);
    }
  }, [filiaisDisponiveis, selectedFiliais]);

  const setSelectedFiliais = (filiais: string[]) => {
    setSelectedFiliaisState(sortFiliais(filiais));
  };

  const toggleFilial = (filial: string) => {
    const normalized = normalizeFilial(filial);
    if (!normalized) return;
    setSelectedFiliaisState((current) => {
      if (current.includes(normalized)) {
        return current.filter((item) => item !== normalized);
      }
      return sortFiliais([...current, normalized]);
    });
  };

  const clearSelection = () => setSelectedFiliaisState([]);

  const selectedFiliaisKey = selectedFiliais.length > 0 ? selectedFiliais.join(",") : "todas";
  const summaryLabel = selectedFiliais.length === 0
    ? "Todas as filiais"
    : selectedFiliais.length === 1
      ? `Filial ${selectedFiliais[0]}`
      : `${selectedFiliais.length} filiais`;

  const value = useMemo<LaraFiliaisContextValue>(() => ({
    filiaisDisponiveis,
    selectedFiliais,
    selectedFiliaisKey,
    filiaisApiParam: selectedFiliais.length > 0 ? selectedFiliais : undefined,
    summaryLabel,
    isLoading,
    isError,
    toggleFilial,
    clearSelection,
    setSelectedFiliais,
  }), [
    filiaisDisponiveis,
    selectedFiliais,
    selectedFiliaisKey,
    summaryLabel,
    isLoading,
    isError,
  ]);

  return (
    <LaraFiliaisContext.Provider value={value}>
      {children}
    </LaraFiliaisContext.Provider>
  );
}

export function useLaraFiliaisFilter(): LaraFiliaisContextValue {
  const context = useContext(LaraFiliaisContext);
  if (!context) {
    throw new Error("useLaraFiliaisFilter must be used within LaraFiliaisProvider.");
  }
  return context;
}
