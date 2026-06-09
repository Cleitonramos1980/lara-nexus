import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LaraFiliaisProvider } from "./contexts/LaraFiliaisContext.tsx";
import { AuthProvider } from "./contexts/AuthContext.tsx";

const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const LaraDashboard = lazy(() => import("./pages/lara/LaraDashboard.tsx"));
const LaraAtendimentos = lazy(() => import("./pages/lara/LaraAtendimentos.tsx"));
const LaraConversas = lazy(() => import("./pages/lara/LaraConversas.tsx"));
const LaraClientes = lazy(() => import("./pages/lara/LaraClientes.tsx"));
const LaraClienteDetalhe = lazy(() => import("./pages/lara/LaraClienteDetalhe.tsx"));
const LaraTitulos = lazy(() => import("./pages/lara/LaraTitulos.tsx"));
const LaraReguaAtiva = lazy(() => import("./pages/lara/LaraReguaAtiva.tsx"));
const LaraReguaConfig = lazy(() => import("./pages/lara/LaraReguaConfig.tsx"));
const LaraCases = lazy(() => import("./pages/lara/LaraCases.tsx"));
const LaraOptout = lazy(() => import("./pages/lara/LaraOptout.tsx"));
const LaraLogs = lazy(() => import("./pages/lara/LaraLogs.tsx"));
const LaraConfiguracoes = lazy(() => import("./pages/lara/LaraConfiguracoes.tsx"));
const LaraMonitoramento = lazy(() => import("./pages/lara/LaraMonitoramento.tsx"));
const LaraPortal = lazy(() => import("./pages/lara/LaraPortal.tsx"));
const LaraNegociacaoConfig = lazy(() => import("./pages/lara/LaraNegociacaoConfig.tsx"));
const LaraDashboardPreditivo = lazy(() => import("./pages/lara/LaraDashboardPreditivo.tsx"));
const LaraFeedbackInsights = lazy(() => import("./pages/lara/LaraFeedbackInsights.tsx"));
const LaraPromessas = lazy(() => import("./pages/lara/LaraPromessas.tsx"));
const LaraAtendimentoHumano = lazy(() => import("./pages/lara/LaraAtendimentoHumano.tsx"));

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
    <LaraFiliaisProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Navigate to="/lara/dashboard" replace />} />
              <Route path="/lara" element={<Navigate to="/lara/dashboard" replace />} />
              <Route path="/lara/dashboard" element={<LaraDashboard />} />
              <Route path="/lara/atendimentos" element={<LaraAtendimentos />} />
              <Route path="/lara/conversas" element={<LaraConversas />} />
              <Route path="/lara/clientes" element={<LaraClientes />} />
              <Route path="/lara/clientes/:id" element={<LaraClienteDetalhe />} />
              <Route path="/lara/titulos" element={<LaraTitulos />} />
              <Route path="/lara/regua-ativa" element={<LaraReguaAtiva />} />
              <Route path="/lara/regua-config" element={<LaraReguaConfig />} />
              <Route path="/lara/cases" element={<LaraCases />} />
              <Route path="/lara/optout" element={<LaraOptout />} />
              <Route path="/lara/logs" element={<LaraLogs />} />
              <Route path="/lara/configuracoes" element={<LaraConfiguracoes />} />
              <Route path="/lara/monitoramento" element={<LaraMonitoramento />} />
              <Route path="/lara/negociacao" element={<LaraNegociacaoConfig />} />
              <Route path="/lara/dashboard-preditivo" element={<LaraDashboardPreditivo />} />
              <Route path="/lara/feedback" element={<LaraFeedbackInsights />} />
              <Route path="/lara/promessas" element={<LaraPromessas />} />
              <Route path="/lara/atendimento-humano" element={<LaraAtendimentoHumano />} />
              {/* Portal Self-Service — rota pública, sem auth */}
              <Route path="/lara/portal/:token" element={<LaraPortal />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </LaraFiliaisProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
