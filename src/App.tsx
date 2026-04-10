import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound.tsx";
import LaraDashboard from "./pages/lara/LaraDashboard.tsx";
import LaraAtendimentos from "./pages/lara/LaraAtendimentos.tsx";
import LaraConversas from "./pages/lara/LaraConversas.tsx";
import LaraClientes from "./pages/lara/LaraClientes.tsx";
import LaraClienteDetalhe from "./pages/lara/LaraClienteDetalhe.tsx";
import LaraTitulos from "./pages/lara/LaraTitulos.tsx";
import LaraReguaAtiva from "./pages/lara/LaraReguaAtiva.tsx";
import LaraReguaConfig from "./pages/lara/LaraReguaConfig.tsx";
import LaraCases from "./pages/lara/LaraCases.tsx";
import LaraOptout from "./pages/lara/LaraOptout.tsx";
import LaraLogs from "./pages/lara/LaraLogs.tsx";
import LaraConfiguracoes from "./pages/lara/LaraConfiguracoes.tsx";
import LaraMonitoramento from "./pages/lara/LaraMonitoramento.tsx";
import { LaraFiliaisProvider } from "./contexts/LaraFiliaisContext.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LaraFiliaisProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/lara/dashboard" replace />} />
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
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </LaraFiliaisProvider>
  </QueryClientProvider>
);

export default App;
