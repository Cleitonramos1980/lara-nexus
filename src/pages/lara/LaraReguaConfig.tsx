import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Zap, Clock, MessageSquare, Settings2, GripVertical, Plus, Trash2,
  Save, AlertTriangle, CheckCircle, Ban, ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getReguaConfig, saveReguaConfig } from '@/services/laraApi';

interface EtapaRegua {
  id: string;
  codigo: string;
  nome: string;
  dias: number;
  tipo: 'preventivo' | 'reativo';
  ativo: boolean;
  horario_inicio: string;
  horario_fim: string;
  cooldown_horas: number;
  respeitar_optout: boolean;
  canal: string;
  mensagem_template: string;
  acoes: string[];
  max_tentativas: number;
  prioridade: number;
}

const initialEtapas: EtapaRegua[] = [
  {
    id: 'e1', codigo: 'D-3', nome: 'Preventivo 3 dias antes', dias: -3, tipo: 'preventivo',
    ativo: true, horario_inicio: '08:00', horario_fim: '18:00', cooldown_horas: 24,
    respeitar_optout: true, canal: 'WhatsApp', max_tentativas: 1, prioridade: 1,
    mensagem_template: 'OlÃ¡ {cliente}! Lembramos que o tÃ­tulo {duplicata} no valor de {valor} vence em {vencimento}. Deseja receber o boleto atualizado?',
    acoes: ['Enviar boleto', 'Enviar PIX'],
  },
  {
    id: 'e2', codigo: 'D0', nome: 'Dia do vencimento', dias: 0, tipo: 'reativo',
    ativo: true, horario_inicio: '08:00', horario_fim: '18:00', cooldown_horas: 24,
    respeitar_optout: true, canal: 'WhatsApp', max_tentativas: 2, prioridade: 2,
    mensagem_template: 'OlÃ¡ {cliente}! Hoje Ã© o vencimento do tÃ­tulo {duplicata} no valor de {valor}. Efetue o pagamento para evitar encargos.',
    acoes: ['Enviar boleto', 'Enviar PIX', 'Registrar promessa'],
  },
  {
    id: 'e3', codigo: 'D+3', nome: '3 dias apÃ³s vencimento', dias: 3, tipo: 'reativo',
    ativo: true, horario_inicio: '09:00', horario_fim: '17:00', cooldown_horas: 48,
    respeitar_optout: true, canal: 'WhatsApp', max_tentativas: 2, prioridade: 3,
    mensagem_template: 'OlÃ¡ {cliente}! O tÃ­tulo {duplicata} venceu hÃ¡ 3 dias. Valor atualizado: {valor}. Regularize para evitar restriÃ§Ãµes.',
    acoes: ['Enviar boleto', 'Enviar PIX', 'Registrar promessa', 'NegociaÃ§Ã£o'],
  },
  {
    id: 'e4', codigo: 'D+7', nome: '7 dias apÃ³s vencimento', dias: 7, tipo: 'reativo',
    ativo: true, horario_inicio: '09:00', horario_fim: '17:00', cooldown_horas: 48,
    respeitar_optout: true, canal: 'WhatsApp', max_tentativas: 2, prioridade: 4,
    mensagem_template: 'OlÃ¡ {cliente}! VocÃª possui tÃ­tulos vencidos hÃ¡ mais de 7 dias totalizando {valor}. Entre em contato para negociar.',
    acoes: ['Enviar boleto', 'Enviar PIX', 'Registrar promessa', 'NegociaÃ§Ã£o', 'Escalar para humano'],
  },
  {
    id: 'e5', codigo: 'D+15', nome: '15 dias apÃ³s vencimento', dias: 15, tipo: 'reativo',
    ativo: false, horario_inicio: '09:00', horario_fim: '16:00', cooldown_horas: 72,
    respeitar_optout: true, canal: 'WhatsApp', max_tentativas: 3, prioridade: 5,
    mensagem_template: 'OlÃ¡ {cliente}! Seus tÃ­tulos estÃ£o vencidos hÃ¡ mais de 15 dias. Valor total: {valor}. Ã‰ importante regularizar sua situaÃ§Ã£o.',
    acoes: ['Enviar boleto', 'NegociaÃ§Ã£o', 'Escalar para humano'],
  },
  {
    id: 'e6', codigo: 'D+30', nome: '30 dias apÃ³s vencimento', dias: 30, tipo: 'reativo',
    ativo: true, horario_inicio: '09:00', horario_fim: '16:00', cooldown_horas: 72,
    respeitar_optout: true, canal: 'WhatsApp', max_tentativas: 3, prioridade: 6,
    mensagem_template: 'OlÃ¡ {cliente}! TÃ­tulos vencidos hÃ¡ mais de 30 dias. Valor: {valor}. RestriÃ§Ãµes podem ser aplicadas. Regularize urgente.',
    acoes: ['NegociaÃ§Ã£o', 'Escalar para humano'],
  },
];

const ACOES_DISPONIVEIS = [
  'Enviar boleto', 'Enviar PIX', 'Registrar promessa', 'NegociaÃ§Ã£o',
  'Escalar para humano', 'Notificar supervisÃ£o', 'Bloquear crÃ©dito',
];

export default function LaraReguaConfig() {
  const [etapas, setEtapas] = useState<EtapaRegua[]>(initialEtapas);
  const [selectedId, setSelectedId] = useState<string>(etapas[0]?.id || '');
  const [saved, setSaved] = useState(false);
  const { data: reguaConfig } = useQuery({
    queryKey: ['lara-regua-config'],
    queryFn: getReguaConfig,
    staleTime: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: saveReguaConfig,
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const selected = etapas.find(e => e.id === selectedId);

  useEffect(() => {
    if (!reguaConfig?.templates?.length) return;
    const mapped: EtapaRegua[] = reguaConfig.templates
      .sort((a, b) => a.ordem_execucao - b.ordem_execucao)
      .map((template, idx) => ({
        id: template.id,
        codigo: template.etapa,
        nome: template.nome_template,
        dias: Number(template.etapa.replace('D', '').replace('+', '') || 0),
        tipo: template.etapa.includes('-') ? 'preventivo' : 'reativo',
        ativo: template.ativo,
        horario_inicio: '08:00',
        horario_fim: '18:00',
        cooldown_horas: 24,
        respeitar_optout: true,
        canal: template.canal,
        mensagem_template: template.mensagem_template,
        acoes: [],
        max_tentativas: 2,
        prioridade: idx + 1,
      }));
    setEtapas(mapped);
    setSelectedId(mapped[0]?.id || '');
  }, [reguaConfig]);

  const updateEtapa = (id: string, patch: Partial<EtapaRegua>) => {
    setEtapas(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
    setSaved(false);
  };

  const addEtapa = () => {
    const newId = `e${Date.now()}`;
    const nova: EtapaRegua = {
      id: newId, codigo: 'D+?', nome: 'Nova etapa', dias: 0, tipo: 'reativo',
      ativo: false, horario_inicio: '09:00', horario_fim: '17:00', cooldown_horas: 24,
      respeitar_optout: true, canal: 'WhatsApp', max_tentativas: 1,
      prioridade: etapas.length + 1,
      mensagem_template: 'OlÃ¡ {cliente}! ...',
      acoes: [],
    };
    setEtapas(prev => [...prev, nova]);
    setSelectedId(newId);
    setSaved(false);
  };

  const removeEtapa = (id: string) => {
    setEtapas(prev => prev.filter(e => e.id !== id));
    if (selectedId === id) setSelectedId(etapas[0]?.id || '');
    setSaved(false);
  };

  const handleSave = () => {
    saveMutation.mutate({
      templates: etapas.map(etapa => ({
        id: etapa.id,
        etapa: etapa.codigo,
        nome_template: etapa.nome,
        canal: etapa.canal,
        mensagem_template: etapa.mensagem_template,
        ativo: etapa.ativo,
        ordem_execucao: etapa.prioridade,
      })),
    });
  };

  const toggleAcao = (etapaId: string, acao: string) => {
    const etapa = etapas.find(e => e.id === etapaId);
    if (!etapa) return;
    const acoes = etapa.acoes.includes(acao)
      ? etapa.acoes.filter(a => a !== acao)
      : [...etapa.acoes, acao];
    updateEtapa(etapaId, { acoes });
  };

  return (
    <LaraLayout>
      <PageHeader
        title="ParametrizaÃ§Ã£o da RÃ©gua"
        subtitle="Defina etapas, prazos, mensagens e regras da rÃ©gua de cobranÃ§a"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="text-xs" onClick={addEtapa}>
              <Plus className="h-3 w-3 mr-1" />Nova Etapa
            </Button>
            <Button size="sm" className="text-xs" onClick={handleSave}>
              <Save className="h-3 w-3 mr-1" />{saveMutation.isPending ? 'Salvando...' : saved ? 'Salvo!' : 'Salvar Alteracoes'}
            </Button>
          </div>
        }
      />

      {saved && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-lara-success/30 bg-lara-success/5 p-3 text-sm text-lara-success">
          <CheckCircle className="h-4 w-4" />
          ConfiguraÃ§Ãµes salvas com sucesso. As alteraÃ§Ãµes serÃ£o aplicadas no prÃ³ximo ciclo da rÃ©gua.
        </div>
      )}

      {/* Timeline visual */}
      <div className="mb-6 rounded-lg border bg-card p-4">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-3">Fluxo da RÃ©gua de CobranÃ§a</p>
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {etapas.sort((a, b) => a.dias - b.dias).map((etapa, i) => (
            <div key={etapa.id} className="flex items-center shrink-0">
              <button
                onClick={() => setSelectedId(etapa.id)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-center transition-all min-w-[100px]",
                  selectedId === etapa.id ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/50",
                  !etapa.ativo && "opacity-50"
                )}
              >
                <p className="text-sm font-bold text-foreground">{etapa.codigo}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{etapa.dias < 0 ? `${Math.abs(etapa.dias)}d antes` : etapa.dias === 0 ? 'Vencimento' : `${etapa.dias}d apÃ³s`}</p>
                <div className="mt-1.5">
                  {etapa.ativo ? (
                    <Badge variant="default" className="text-[9px]">Ativo</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[9px]">Inativo</Badge>
                  )}
                </div>
              </button>
              {i < etapas.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground mx-1 shrink-0" />}
            </div>
          ))}
        </div>
      </div>

      {/* Editor da etapa selecionada */}
      {selected ? (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Lista lateral */}
          <div className="border rounded-lg bg-card overflow-hidden">
            <div className="p-3 border-b">
              <p className="text-xs font-semibold text-foreground">Etapas ({etapas.length})</p>
            </div>
            <ScrollArea className="h-[420px]">
              <div className="divide-y">
                {etapas.sort((a, b) => a.dias - b.dias).map(e => (
                  <button
                    key={e.id}
                    onClick={() => setSelectedId(e.id)}
                    className={cn(
                      "w-full text-left p-3 hover:bg-muted/50 transition-colors flex items-center gap-2",
                      selectedId === e.id && "bg-accent/60 border-l-2 border-l-primary"
                    )}
                  >
                    <GripVertical className="h-3 w-3 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-foreground">{e.codigo}</span>
                        {!e.ativo && <Ban className="h-3 w-3 text-muted-foreground" />}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{e.nome}</p>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* FormulÃ¡rio da etapa */}
          <div className="border rounded-lg bg-card overflow-hidden">
            <div className="p-4 border-b bg-muted/20 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold",
                  selected.ativo ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                )}>
                  {selected.codigo}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">{selected.nome}</h3>
                  <p className="text-[11px] text-muted-foreground">
                    {selected.tipo === 'preventivo' ? 'Disparo preventivo' : 'Disparo reativo'} Â· Prioridade {selected.prioridade}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label htmlFor="ativo-switch" className="text-xs text-muted-foreground">Ativo</Label>
                  <Switch
                    id="ativo-switch"
                    checked={selected.ativo}
                    onCheckedChange={v => updateEtapa(selected.id, { ativo: v })}
                  />
                </div>
                <Button variant="ghost" size="sm" className="text-xs text-destructive hover:text-destructive" onClick={() => removeEtapa(selected.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <ScrollArea className="h-[380px]">
              <div className="p-5">
                <Tabs defaultValue="geral" className="w-full">
                  <TabsList className="mb-4">
                    <TabsTrigger value="geral" className="text-xs"><Settings2 className="h-3 w-3 mr-1" />Geral</TabsTrigger>
                    <TabsTrigger value="mensagem" className="text-xs"><MessageSquare className="h-3 w-3 mr-1" />Mensagem</TabsTrigger>
                    <TabsTrigger value="regras" className="text-xs"><Zap className="h-3 w-3 mr-1" />Regras e AÃ§Ãµes</TabsTrigger>
                  </TabsList>

                  <TabsContent value="geral" className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs">CÃ³digo da Etapa</Label>
                        <Input
                          value={selected.codigo}
                          onChange={e => updateEtapa(selected.id, { codigo: e.target.value })}
                          className="mt-1 text-sm"
                          placeholder="Ex: D+7"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Nome da Etapa</Label>
                        <Input
                          value={selected.nome}
                          onChange={e => updateEtapa(selected.id, { nome: e.target.value })}
                          className="mt-1 text-sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label className="text-xs">Dias em relaÃ§Ã£o ao vencimento</Label>
                        <Input
                          type="number"
                          value={selected.dias}
                          onChange={e => updateEtapa(selected.id, { dias: parseInt(e.target.value) || 0 })}
                          className="mt-1 text-sm"
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">Negativo = antes, 0 = dia, positivo = apÃ³s</p>
                      </div>
                      <div>
                        <Label className="text-xs">Tipo</Label>
                        <select
                          value={selected.tipo}
                          onChange={e => updateEtapa(selected.id, { tipo: e.target.value as 'preventivo' | 'reativo' })}
                          className="mt-1 w-full text-sm border rounded px-2 py-2 bg-background text-foreground"
                        >
                          <option value="preventivo">Preventivo</option>
                          <option value="reativo">Reativo</option>
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs">Canal</Label>
                        <Input value={selected.canal} disabled className="mt-1 text-sm" />
                        <p className="text-[10px] text-muted-foreground mt-1">IntegraÃ§Ã£o via n8n</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label className="text-xs">HorÃ¡rio InÃ­cio</Label>
                        <Input
                          type="time"
                          value={selected.horario_inicio}
                          onChange={e => updateEtapa(selected.id, { horario_inicio: e.target.value })}
                          className="mt-1 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">HorÃ¡rio Fim</Label>
                        <Input
                          type="time"
                          value={selected.horario_fim}
                          onChange={e => updateEtapa(selected.id, { horario_fim: e.target.value })}
                          className="mt-1 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Cooldown (horas)</Label>
                        <Input
                          type="number"
                          value={selected.cooldown_horas}
                          onChange={e => updateEtapa(selected.id, { cooldown_horas: parseInt(e.target.value) || 0 })}
                          className="mt-1 text-sm"
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">Intervalo mÃ­nimo entre disparos</p>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs">MÃ¡x. tentativas por cliente</Label>
                      <Input
                        type="number"
                        value={selected.max_tentativas}
                        onChange={e => updateEtapa(selected.id, { max_tentativas: parseInt(e.target.value) || 1 })}
                        className="mt-1 text-sm w-32"
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="mensagem" className="space-y-4">
                    <div>
                      <Label className="text-xs">Template da Mensagem</Label>
                      <Textarea
                        value={selected.mensagem_template}
                        onChange={e => updateEtapa(selected.id, { mensagem_template: e.target.value })}
                        className="mt-1 text-sm min-h-[140px]"
                        placeholder="Use {cliente}, {duplicata}, {valor}, {vencimento} como variÃ¡veis..."
                      />
                      <p className="text-[10px] text-muted-foreground mt-1.5">
                        VariÃ¡veis disponÃ­veis: <code className="bg-muted px-1 rounded">{'{cliente}'}</code>{' '}
                        <code className="bg-muted px-1 rounded">{'{duplicata}'}</code>{' '}
                        <code className="bg-muted px-1 rounded">{'{valor}'}</code>{' '}
                        <code className="bg-muted px-1 rounded">{'{vencimento}'}</code>{' '}
                        <code className="bg-muted px-1 rounded">{'{dias_atraso}'}</code>{' '}
                        <code className="bg-muted px-1 rounded">{'{codcli}'}</code>
                      </p>
                    </div>

                    {/* Preview */}
                    <div>
                      <Label className="text-xs">PrÃ©-visualizaÃ§Ã£o</Label>
                      <div className="mt-2 rounded-lg bg-primary/5 border border-primary/10 p-4">
                        <div className="flex items-center gap-1.5 mb-2">
                          <MessageSquare className="h-3 w-3 text-primary" />
                          <span className="text-[10px] font-medium text-muted-foreground">Lara</span>
                        </div>
                        <p className="text-sm text-foreground">
                          {selected.mensagem_template
                            .replace('{cliente}', 'Comercial Norte Distribuidora')
                            .replace('{duplicata}', 'NF-2024-001234')
                            .replace('{valor}', 'R$ 12.500,00')
                            .replace('{vencimento}', '15/04/2025')
                            .replace('{dias_atraso}', '7')
                            .replace('{codcli}', '10234')
                          }
                        </p>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="regras" className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-xs">Respeitar Opt-out</Label>
                        <Switch
                          checked={selected.respeitar_optout}
                          onCheckedChange={v => updateEtapa(selected.id, { respeitar_optout: v })}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {selected.respeitar_optout
                          ? 'Clientes com opt-out ativo NÃƒO receberÃ£o disparos desta etapa.'
                          : 'âš ï¸ AtenÃ§Ã£o: disparos serÃ£o enviados mesmo para clientes com opt-out.'
                        }
                      </p>
                      {!selected.respeitar_optout && (
                        <div className="flex items-center gap-1.5 mt-2 text-xs text-destructive">
                          <AlertTriangle className="h-3 w-3" /> Desativar opt-out pode violar compliance.
                        </div>
                      )}
                    </div>

                    <div>
                      <Label className="text-xs mb-2 block">AÃ§Ãµes permitidas nesta etapa</Label>
                      <div className="flex flex-wrap gap-2">
                        {ACOES_DISPONIVEIS.map(acao => (
                          <button
                            key={acao}
                            onClick={() => toggleAcao(selected.id, acao)}
                            className={cn(
                              "rounded-md border px-3 py-1.5 text-xs transition-colors",
                              selected.acoes.includes(acao)
                                ? "bg-primary/10 border-primary/30 text-primary font-medium"
                                : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
                            )}
                          >
                            {acao}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border bg-muted/20 p-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Resumo da Etapa</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><span className="text-muted-foreground">CÃ³digo:</span> <strong>{selected.codigo}</strong></div>
                        <div><span className="text-muted-foreground">Dias:</span> <strong>{selected.dias}</strong></div>
                        <div><span className="text-muted-foreground">HorÃ¡rio:</span> <strong>{selected.horario_inicio} â€“ {selected.horario_fim}</strong></div>
                        <div><span className="text-muted-foreground">Cooldown:</span> <strong>{selected.cooldown_horas}h</strong></div>
                        <div><span className="text-muted-foreground">Tentativas:</span> <strong>{selected.max_tentativas}</strong></div>
                        <div><span className="text-muted-foreground">Opt-out:</span> <strong>{selected.respeitar_optout ? 'Sim' : 'NÃ£o'}</strong></div>
                        <div className="col-span-2"><span className="text-muted-foreground">AÃ§Ãµes:</span> <strong>{selected.acoes.join(', ') || 'Nenhuma'}</strong></div>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </ScrollArea>
          </div>
        </div>
      ) : (
        <div className="text-center text-sm text-muted-foreground py-12">
          Nenhuma etapa selecionada. Clique em uma etapa ou crie uma nova.
        </div>
      )}
    </LaraLayout>
  );
}


