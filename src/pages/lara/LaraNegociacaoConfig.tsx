/**
 * Lara — Página de Configuração de Políticas de Negociação
 * Permite gestores configurar descontos e parcelamentos por etapa da régua.
 */
import { useState, useEffect } from "react";

type Politica = {
  etapa_regua: string;
  desconto_maximo_pct: number;
  parcelas_maximas: number;
  entrada_minima_pct: number;
  ativo: boolean;
};

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

const LARA_API_BASE = import.meta.env.VITE_LARA_API_BASE_URL ?? "/api";
const LARA_API_KEY = import.meta.env.VITE_LARA_API_KEY ?? "";

const headers = {
  "Content-Type": "application/json",
  ...(LARA_API_KEY ? { "x-lara-api-key": LARA_API_KEY } : {}),
};

const ETAPAS = ["D-3", "D0", "D+3", "D+7", "D+15", "D+30"];

const ETAPA_LABELS: Record<string, { cor: string; descricao: string }> = {
  "D-3": { cor: "#34d399", descricao: "3 dias antes do vencimento" },
  "D0":  { cor: "#60a5fa", descricao: "No dia do vencimento" },
  "D+3": { cor: "#fbbf24", descricao: "3 dias de atraso" },
  "D+7": { cor: "#f97316", descricao: "7 dias de atraso" },
  "D+15":{ cor: "#f43f5e", descricao: "15 dias de atraso" },
  "D+30":{ cor: "#a855f7", descricao: "30+ dias de atraso" },
};

async function fetchPoliticas(): Promise<Politica[]> {
  const res = await fetch(`${LARA_API_BASE}/lara/negociacao/politicas`, { headers });
  return res.json();
}

async function salvarPolitica(etapa: string, data: Omit<Politica, "etapa_regua">): Promise<void> {
  await fetch(`${LARA_API_BASE}/lara/negociacao/politicas/${etapa}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(data),
  });
}

async function simular(codcli: number): Promise<SimulacaoResult> {
  const res = await fetch(`${LARA_API_BASE}/lara/negociacao/simular`, {
    method: "POST",
    headers,
    body: JSON.stringify({ codcli }),
  });
  return res.json();
}

function formatBRL(value: number) {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function LaraNegociacaoConfig() {
  const [politicas, setPoliticas] = useState<Politica[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Politica, "etapa_regua">>({
    desconto_maximo_pct: 0, parcelas_maximas: 1, entrada_minima_pct: 30, ativo: true,
  });
  const [salvando, setSalvando] = useState(false);
  const [codcliSim, setCodcliSim] = useState("");
  const [simulacao, setSimulacao] = useState<SimulacaoResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  useEffect(() => {
    fetchPoliticas().then(setPoliticas).catch(() => {});
  }, []);

  const politicasMap = new Map(politicas.map((p) => [p.etapa_regua, p]));

  function abrirEdicao(etapa: string) {
    const p = politicasMap.get(etapa);
    setForm(p
      ? { desconto_maximo_pct: p.desconto_maximo_pct, parcelas_maximas: p.parcelas_maximas, entrada_minima_pct: p.entrada_minima_pct, ativo: p.ativo }
      : { desconto_maximo_pct: 5, parcelas_maximas: 3, entrada_minima_pct: 25, ativo: true }
    );
    setEditando(etapa);
  }

  async function salvar() {
    if (!editando) return;
    setSalvando(true);
    try {
      await salvarPolitica(editando, form);
      setPoliticas((prev) => {
        const exists = prev.find((p) => p.etapa_regua === editando);
        if (exists) return prev.map((p) => p.etapa_regua === editando ? { ...p, ...form } : p);
        return [...prev, { etapa_regua: editando, ...form }];
      });
      setEditando(null);
    } finally {
      setSalvando(false);
    }
  }

  async function executarSimulacao() {
    const n = parseInt(codcliSim);
    if (!n) return;
    setSimLoading(true);
    setSimulacao(null);
    try {
      const res = await simular(n);
      setSimulacao(res);
    } catch {
      setSimulacao({ pode_negociar: false, motivo_bloqueio: "Erro ao simular. Verifique o código do cliente." });
    } finally {
      setSimLoading(false);
    }
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: "900px", margin: "0 auto" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--lara-text, #f1f5f9)", marginBottom: "0.5rem" }}>
          🤝 Políticas de Negociação Autônoma
        </h1>
        <p style={{ color: "var(--lara-muted, #94a3b8)", fontSize: "0.9rem" }}>
          Configure os limites de desconto e parcelamento que a Lara pode oferecer autonomamente por etapa da régua.
        </p>
      </div>

      {/* Cards de política por etapa */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        {ETAPAS.map((etapa) => {
          const p = politicasMap.get(etapa);
          const info = ETAPA_LABELS[etapa];
          return (
            <div key={etapa} style={{
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${info.cor}40`,
              borderRadius: "12px",
              padding: "1.25rem",
              position: "relative",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <span style={{
                  background: `${info.cor}20`,
                  color: info.cor,
                  padding: "2px 10px",
                  borderRadius: "20px",
                  fontSize: "0.8rem",
                  fontWeight: 700,
                }}>{etapa}</span>
                <span style={{
                  background: p?.ativo !== false ? "rgba(52,211,153,0.1)" : "rgba(239,68,68,0.1)",
                  color: p?.ativo !== false ? "#34d399" : "#f87171",
                  padding: "2px 8px",
                  borderRadius: "20px",
                  fontSize: "0.75rem",
                }}>{p?.ativo !== false ? "Ativo" : "Inativo"}</span>
              </div>
              <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.78rem", marginBottom: "1rem" }}>{info.descricao}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "0.88rem", color: "rgba(255,255,255,0.8)" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Desconto máx.</span>
                  <strong style={{ color: "#34d399" }}>{p?.desconto_maximo_pct ?? "—"}%</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Parcelas máx.</span>
                  <strong>{p?.parcelas_maximas ?? "—"}x</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Entrada mín.</span>
                  <strong>{p?.entrada_minima_pct ?? "—"}%</strong>
                </div>
              </div>
              <button
                onClick={() => abrirEdicao(etapa)}
                style={{
                  marginTop: "1rem",
                  width: "100%",
                  padding: "0.5rem",
                  background: `${info.cor}15`,
                  border: `1px solid ${info.cor}40`,
                  borderRadius: "8px",
                  color: info.cor,
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  transition: "all 0.2s",
                }}
              >
                ✏️ Editar
              </button>
            </div>
          );
        })}
      </div>

      {/* Modal de edição */}
      {editando && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, padding: "1rem",
        }}>
          <div style={{
            background: "#1e1e2e",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "16px",
            padding: "2rem",
            width: "100%", maxWidth: "440px",
          }}>
            <h2 style={{ color: "#fff", marginBottom: "1.5rem", fontSize: "1.1rem" }}>
              Política para etapa <span style={{ color: ETAPA_LABELS[editando].cor }}>{editando}</span>
            </h2>

            {[
              { label: "Desconto máximo (%)", key: "desconto_maximo_pct", min: 0, max: 50, step: 1 },
              { label: "Parcelas máximas", key: "parcelas_maximas", min: 1, max: 24, step: 1 },
              { label: "Entrada mínima (%)", key: "entrada_minima_pct", min: 0, max: 100, step: 5 },
            ].map((field) => (
              <div key={field.key} style={{ marginBottom: "1rem" }}>
                <label style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>
                  {field.label}
                </label>
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={(form as any)[field.key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: Number(e.target.value) }))}
                  style={{
                    width: "100%", padding: "0.6rem 0.75rem",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: "8px",
                    color: "#fff", fontSize: "1rem",
                    outline: "none",
                  }}
                />
              </div>
            ))}

            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "rgba(255,255,255,0.7)", marginBottom: "1.5rem", cursor: "pointer" }}>
              <input type="checkbox" checked={form.ativo} onChange={(e) => setForm((prev) => ({ ...prev, ativo: e.target.checked }))} />
              Negociação ativa para esta etapa
            </label>

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button onClick={() => setEditando(null)} style={{ flex: 1, padding: "0.7rem", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", color: "rgba(255,255,255,0.7)", cursor: "pointer" }}>
                Cancelar
              </button>
              <button onClick={salvar} disabled={salvando} style={{ flex: 1, padding: "0.7rem", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", border: "none", borderRadius: "8px", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Simulador de negociação */}
      <div style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px",
        padding: "1.5rem",
      }}>
        <h2 style={{ color: "#f1f5f9", fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>
          🧪 Simular Negociação
        </h2>
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
          <input
            type="number"
            placeholder="Código do cliente (codcli)"
            value={codcliSim}
            onChange={(e) => setCodcliSim(e.target.value)}
            style={{ flex: 1, padding: "0.6rem 0.75rem", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", color: "#fff", fontSize: "0.9rem", outline: "none" }}
          />
          <button
            onClick={executarSimulacao}
            disabled={simLoading || !codcliSim}
            style={{ padding: "0.6rem 1.25rem", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", border: "none", borderRadius: "8px", color: "#fff", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}
          >
            {simLoading ? "…" : "Simular"}
          </button>
        </div>

        {simulacao && (
          <div>
            {!simulacao.pode_negociar ? (
              <div style={{ color: "#f87171", background: "rgba(239,68,68,0.1)", padding: "1rem", borderRadius: "8px" }}>
                ❌ {simulacao.motivo_bloqueio}
              </div>
            ) : (
              <div>
                <div style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: "8px", padding: "1rem", marginBottom: "1rem", color: "rgba(255,255,255,0.85)", fontSize: "0.88rem", whiteSpace: "pre-line" }}>
                  {simulacao.mensagem_apresentacao}
                </div>
                {simulacao.propostas?.map((p, i) => (
                  <div key={i} style={{ background: "rgba(255,255,255,0.04)", borderRadius: "8px", padding: "0.75rem 1rem", marginBottom: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ color: "#fff", fontWeight: 600, fontSize: "0.9rem" }}>{p.tipo === "avista" ? "À vista" : `${p.parcelas}x parcelado`}</span>
                      {p.desconto_pct > 0 && <span style={{ marginLeft: "0.5rem", color: "#34d399", fontSize: "0.8rem" }}>-{p.desconto_pct}% desc.</span>}
                    </div>
                    <span style={{ color: "#fff", fontWeight: 700 }}>{formatBRL(p.valor_com_desconto)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
