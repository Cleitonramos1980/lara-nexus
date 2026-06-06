/**
 * Portal Self-Service da Lara
 * Página pública acessada por link único (token) enviado via WhatsApp.
 * Permite ao cliente ver débitos, pagar via PIX/Boleto e ver propostas de negociação.
 */
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";

type PortalStatus = "carregando" | "valido" | "invalido" | "expirado";

type Proposta = {
  tipo: "avista" | "parcelado";
  desconto_pct: number;
  valor_original: number;
  valor_com_desconto: number;
  entrada: number;
  parcelas: number;
  valor_parcela: number;
  mensagem_oferta: string;
};

type PortalData = {
  status: string;
  cliente?: string;
  valor_total?: number;
  titulos?: Array<{ duplicata: string; valor: number; vencimento: string; dias_atraso: number }>;
  propostas?: Proposta[];
  empresa?: string;
  valido_ate?: string;
};

const LARA_API_BASE = import.meta.env.VITE_LARA_API_BASE_URL ?? "/api";

async function fetchPortalData(token: string): Promise<PortalData> {
  const res = await fetch(`${LARA_API_BASE}/lara/portal/${token}`);
  if (!res.ok) throw new Error("Token inválido ou expirado");
  return res.json();
}

async function iniciarPagamento(token: string, forma: "pix" | "boleto", propostaIndex?: number) {
  const res = await fetch(`${LARA_API_BASE}/lara/portal/${token}/pagar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ forma, proposta_index: propostaIndex }),
  });
  return res.json();
}

function formatBRL(value: number): string {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function LaraPortal() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<PortalStatus>("carregando");
  const [dados, setDados] = useState<PortalData | null>(null);
  const [acao, setAcao] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setStatus("invalido"); return; }
    fetchPortalData(token)
      .then((d) => { setDados(d); setStatus("valido"); })
      .catch(() => setStatus("invalido"));
  }, [token]);

  async function handlePagar(forma: "pix" | "boleto", propostaIndex?: number) {
    if (!token) return;
    setProcessando(true);
    try {
      const res = await iniciarPagamento(token, forma, propostaIndex);
      setFeedback(res.mensagem ?? "Solicitação enviada com sucesso!");
      setAcao("confirmado");
    } catch {
      setFeedback("Erro ao processar. Por favor, entre em contato conosco.");
    } finally {
      setProcessando(false);
    }
  }

  return (
    <div className="portal-root">
      <div className="portal-card">
        {/* Cabeçalho */}
        <div className="portal-header">
          <div className="portal-logo">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <circle cx="18" cy="18" r="18" fill="#6366f1" />
              <text x="18" y="24" textAnchor="middle" fontSize="18" fill="white" fontWeight="bold">L</text>
            </svg>
          </div>
          <div>
            <h1 className="portal-title">{dados?.empresa ?? "Portal de Pagamento"}</h1>
            <p className="portal-subtitle">Regularize sua situação financeira</p>
          </div>
        </div>

        {/* Estados */}
        {status === "carregando" && (
          <div className="portal-center">
            <div className="portal-spinner" />
            <p>Carregando seus dados…</p>
          </div>
        )}

        {status === "invalido" && (
          <div className="portal-error">
            <span className="portal-icon-error">⚠️</span>
            <h2>Link inválido ou expirado</h2>
            <p>Este link de pagamento não é mais válido. Por favor, solicite um novo link via WhatsApp.</p>
          </div>
        )}

        {status === "valido" && acao === "confirmado" && (
          <div className="portal-success">
            <span className="portal-icon-success">✅</span>
            <h2>Solicitação enviada!</h2>
            <p>{feedback}</p>
            <p className="portal-small">Você receberá a confirmação pelo WhatsApp em instantes.</p>
          </div>
        )}

        {status === "valido" && acao !== "confirmado" && (
          <>
            {/* Resumo da dívida */}
            {dados?.valor_total != null && (
              <div className="portal-summary">
                <p className="portal-label">Olá{dados.cliente ? `, ${dados.cliente.split(" ")[0]}` : ""}! 👋</p>
                <p className="portal-label">Identificamos o seguinte débito em aberto:</p>
                <div className="portal-valor">
                  {formatBRL(dados.valor_total)}
                </div>
                {dados.titulos && dados.titulos.length > 0 && (
                  <div className="portal-titulos">
                    {dados.titulos.map((t, index) => (
                      <div key={`${t.duplicata}-${t.vencimento}-${t.valor}-${index}`} className="portal-titulo-row">
                        <span>Título {t.duplicata}</span>
                        <span className={t.dias_atraso > 0 ? "portal-atrasado" : ""}>
                          {formatBRL(t.valor)}
                          {t.dias_atraso > 0 && <span className="portal-badge-atraso">{t.dias_atraso}d atraso</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Opções de pagamento */}
            {!acao && (
              <div className="portal-opcoes">
                <h3 className="portal-opcoes-title">Como deseja pagar?</h3>

                <button
                  className="portal-btn portal-btn-pix"
                  disabled={processando}
                  onClick={() => handlePagar("pix")}
                >
                  <span>💠</span>
                  <div>
                    <strong>Pagar via PIX</strong>
                    <small>Aprovação instantânea · 24h por dia</small>
                  </div>
                </button>

                <button
                  className="portal-btn portal-btn-boleto"
                  disabled={processando}
                  onClick={() => handlePagar("boleto")}
                >
                  <span>📄</span>
                  <div>
                    <strong>Pagar via Boleto</strong>
                    <small>Vencimento em 3 dias úteis</small>
                  </div>
                </button>

                {dados?.propostas && dados.propostas.length > 0 && (
                  <div className="portal-negociacao">
                    <h3 className="portal-opcoes-title">💼 Propostas especiais disponíveis</h3>
                    {dados.propostas.map((p, i) => (
                      <button
                        key={i}
                        className="portal-btn portal-btn-negociacao"
                        disabled={processando}
                        onClick={() => handlePagar("boleto", i)}
                      >
                        <span>{i + 1}️⃣</span>
                        <div>
                          <strong>{p.tipo === "avista" ? "À vista" : `${p.parcelas}x parcelado`}</strong>
                          {p.desconto_pct > 0 && (
                            <small className="portal-desconto">{p.desconto_pct}% de desconto</small>
                          )}
                          <small>{formatBRL(p.valor_com_desconto)}</small>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                <button className="portal-btn portal-btn-humano" onClick={() => setAcao("humano")}>
                  <span>💬</span>
                  <div>
                    <strong>Falar com um Especialista</strong>
                    <small>Atendimento humano personalizado</small>
                  </div>
                </button>
              </div>
            )}

            {acao === "humano" && (
              <div className="portal-success">
                <span>👤</span>
                <h2>Atendimento Solicitado</h2>
                <p>Um especialista entrará em contato pelo WhatsApp em breve.</p>
                <button className="portal-btn-voltar" onClick={() => setAcao(null)}>← Voltar às opções</button>
              </div>
            )}
          </>
        )}

        {/* Rodapé */}
        <div className="portal-footer">
          <p>🔒 Dados protegidos conforme a LGPD</p>
          {dados?.valido_ate && <p className="portal-small">Link válido até {new Date(dados.valido_ate).toLocaleDateString("pt-BR")}</p>}
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f0f1a; }
        .portal-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
          padding: 1.5rem;
          font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        }
        .portal-card {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 20px;
          padding: 2rem;
          max-width: 480px;
          width: 100%;
          box-shadow: 0 25px 50px rgba(0,0,0,0.5);
          backdrop-filter: blur(20px);
        }
        .portal-header {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 1.5rem;
          padding-bottom: 1.5rem;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .portal-logo { flex-shrink: 0; }
        .portal-title { color: #fff; font-size: 1.2rem; font-weight: 700; }
        .portal-subtitle { color: rgba(255,255,255,0.5); font-size: 0.85rem; }
        .portal-center { text-align: center; padding: 2rem; color: rgba(255,255,255,0.7); }
        .portal-spinner {
          width: 36px; height: 36px;
          border: 3px solid rgba(99,102,241,0.2);
          border-top-color: #6366f1;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin: 0 auto 1rem;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .portal-error, .portal-success {
          text-align: center;
          padding: 2rem 1rem;
          color: #fff;
        }
        .portal-icon-error { font-size: 2.5rem; display: block; margin-bottom: 1rem; }
        .portal-icon-success { font-size: 2.5rem; display: block; margin-bottom: 1rem; }
        .portal-error h2, .portal-success h2 { font-size: 1.3rem; margin-bottom: 0.75rem; }
        .portal-error p, .portal-success p { color: rgba(255,255,255,0.7); font-size: 0.95rem; }
        .portal-summary { margin-bottom: 1.5rem; }
        .portal-label { color: rgba(255,255,255,0.7); font-size: 0.9rem; margin-bottom: 0.5rem; }
        .portal-valor {
          font-size: 2.5rem;
          font-weight: 800;
          color: #fff;
          text-align: center;
          padding: 1rem;
          background: linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.1));
          border-radius: 12px;
          margin: 1rem 0;
          border: 1px solid rgba(99,102,241,0.3);
        }
        .portal-titulos { display: flex; flex-direction: column; gap: 0.5rem; }
        .portal-titulo-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.6rem 0.75rem;
          background: rgba(255,255,255,0.04);
          border-radius: 8px;
          color: rgba(255,255,255,0.8);
          font-size: 0.9rem;
        }
        .portal-atrasado { color: #f87171; }
        .portal-badge-atraso {
          background: rgba(239,68,68,0.2);
          color: #f87171;
          border-radius: 6px;
          padding: 2px 6px;
          font-size: 0.75rem;
          margin-left: 0.5rem;
        }
        .portal-opcoes { display: flex; flex-direction: column; gap: 0.75rem; }
        .portal-opcoes-title { color: rgba(255,255,255,0.6); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; }
        .portal-btn {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem 1.25rem;
          border-radius: 12px;
          border: 1px solid;
          background: none;
          cursor: pointer;
          text-align: left;
          transition: all 0.2s;
          width: 100%;
        }
        .portal-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .portal-btn span { font-size: 1.5rem; flex-shrink: 0; }
        .portal-btn div { display: flex; flex-direction: column; gap: 2px; }
        .portal-btn strong { color: #fff; font-size: 1rem; }
        .portal-btn small { color: rgba(255,255,255,0.5); font-size: 0.8rem; }
        .portal-btn-pix { border-color: rgba(52,211,153,0.3); background: rgba(52,211,153,0.08); }
        .portal-btn-pix:hover:not(:disabled) { background: rgba(52,211,153,0.15); border-color: rgba(52,211,153,0.6); transform: translateY(-1px); }
        .portal-btn-boleto { border-color: rgba(99,102,241,0.3); background: rgba(99,102,241,0.08); }
        .portal-btn-boleto:hover:not(:disabled) { background: rgba(99,102,241,0.15); border-color: rgba(99,102,241,0.6); transform: translateY(-1px); }
        .portal-btn-negociacao { border-color: rgba(245,158,11,0.3); background: rgba(245,158,11,0.08); }
        .portal-btn-negociacao:hover:not(:disabled) { background: rgba(245,158,11,0.15); transform: translateY(-1px); }
        .portal-btn-humano { border-color: rgba(255,255,255,0.1); background: rgba(255,255,255,0.03); }
        .portal-btn-humano:hover:not(:disabled) { background: rgba(255,255,255,0.07); transform: translateY(-1px); }
        .portal-desconto { color: #34d399 !important; font-weight: 600; }
        .portal-negociacao { margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.5rem; }
        .portal-footer {
          margin-top: 1.5rem;
          padding-top: 1.5rem;
          border-top: 1px solid rgba(255,255,255,0.08);
          text-align: center;
          color: rgba(255,255,255,0.3);
          font-size: 0.8rem;
        }
        .portal-small { font-size: 0.8rem; color: rgba(255,255,255,0.4); margin-top: 0.5rem; }
        .portal-btn-voltar {
          background: none;
          border: 1px solid rgba(255,255,255,0.2);
          color: rgba(255,255,255,0.7);
          padding: 0.5rem 1rem;
          border-radius: 8px;
          cursor: pointer;
          margin-top: 1rem;
          font-size: 0.9rem;
          transition: all 0.2s;
        }
        .portal-btn-voltar:hover { background: rgba(255,255,255,0.08); }
      `}</style>
    </div>
  );
}
