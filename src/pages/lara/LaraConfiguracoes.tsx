import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { getReguaConfig, saveConfiguracoes } from '@/services/laraApi';

type AlertContato = { nome: string; numero: string };
const ALERT_CONTATO_VAZIO: AlertContato = { nome: '', numero: '' };

export default function LaraConfiguracoes() {
  const [assinatura, setAssinatura] = useState('Lara · Assistente Financeira');
  const [empresa, setEmpresa] = useState('Grupo Norte Distribuidora');
  const [pixChave, setPixChave] = useState('financeiro@empresa.com.br');
  const [boletoBaseUrl, setBoletoBaseUrl] = useState('https://pagamentos.exemplo.local/boleto');
  const [cooldownMin, setCooldownMin] = useState('30');
  const [janelaContextoHoras, setJanelaContextoHoras] = useState('72');
  const [inicioDisparo, setInicioDisparo] = useState('08:00');
  const [fimDisparo, setFimDisparo] = useState('18:00');
  const [alertContatos, setAlertContatos] = useState<AlertContato[]>([
    { ...ALERT_CONTATO_VAZIO },
    { ...ALERT_CONTATO_VAZIO },
    { ...ALERT_CONTATO_VAZIO },
  ]);
  const [slaNivel1Min, setSlaNivel1Min] = useState('30');
  const [slaNivel2Min, setSlaNivel2Min] = useState('60');
  const [slaGerenteRepeatMin, setSlaGerenteRepeatMin] = useState('15');
  const [slaSupervisorNome, setSlaSupervisorNome] = useState('');
  const [slaSupervisorNumero, setSlaSupervisorNumero] = useState('');
  const [slaGerenteNome, setSlaGerenteNome] = useState('');
  const [slaGerenteNumero, setSlaGerenteNumero] = useState('');
  const [horarioComercialInicio, setHorarioComercialInicio] = useState('8');
  const [horarioComercialFim, setHorarioComercialFim] = useState('18');

  const { data: configData } = useQuery({
    queryKey: ['lara-regua-config'],
    queryFn: getReguaConfig,
    staleTime: 60_000,
  });

  useEffect(() => {
    const cfg = configData?.configuracoes ?? [];
    const map = new Map(cfg.map(item => [item.chave, item.valor]));
    if (map.get('LARA_ASSINATURA')) setAssinatura(map.get('LARA_ASSINATURA') || assinatura);
    if (map.get('LARA_EMPRESA_NOME')) setEmpresa(map.get('LARA_EMPRESA_NOME') || empresa);
    if (map.get('LARA_PIX_CHAVE')) setPixChave(map.get('LARA_PIX_CHAVE') || pixChave);
    if (map.get('LARA_BASE_BOLETO_URL')) setBoletoBaseUrl(map.get('LARA_BASE_BOLETO_URL') || boletoBaseUrl);
    if (map.get('JANELA_RESPOSTA_SEM_IDENTIFICACAO_MIN')) setCooldownMin(map.get('JANELA_RESPOSTA_SEM_IDENTIFICACAO_MIN') || cooldownMin);
    if (map.get('JANELA_CONTEXTO_HORAS')) setJanelaContextoHoras(map.get('JANELA_CONTEXTO_HORAS') || janelaContextoHoras);
    if (map.get('LARA_HORARIO_INICIO')) setInicioDisparo(map.get('LARA_HORARIO_INICIO') || inicioDisparo);
    if (map.get('LARA_HORARIO_FIM')) setFimDisparo(map.get('LARA_HORARIO_FIM') || fimDisparo);
    setAlertContatos([1, 2, 3].map(i => ({
      nome: map.get(`LARA_ALERT_CONTATO_${i}_NOME`) || '',
      numero: map.get(`LARA_ALERT_CONTATO_${i}_NUMERO`) || '',
    })));
    if (map.get('LARA_SLA_NIVEL1_MIN')) setSlaNivel1Min(map.get('LARA_SLA_NIVEL1_MIN') || '30');
    if (map.get('LARA_SLA_NIVEL2_MIN')) setSlaNivel2Min(map.get('LARA_SLA_NIVEL2_MIN') || '60');
    if (map.get('LARA_SLA_GERENTE_REPEAT_MIN')) setSlaGerenteRepeatMin(map.get('LARA_SLA_GERENTE_REPEAT_MIN') || '15');
    if (map.get('LARA_SLA_SUPERVISOR_NOME')) setSlaSupervisorNome(map.get('LARA_SLA_SUPERVISOR_NOME') || '');
    if (map.get('LARA_SLA_SUPERVISOR_NUMERO')) setSlaSupervisorNumero(map.get('LARA_SLA_SUPERVISOR_NUMERO') || '');
    if (map.get('LARA_SLA_GERENTE_NOME')) setSlaGerenteNome(map.get('LARA_SLA_GERENTE_NOME') || '');
    if (map.get('LARA_SLA_GERENTE_NUMERO')) setSlaGerenteNumero(map.get('LARA_SLA_GERENTE_NUMERO') || '');
    if (map.get('LARA_HORARIO_COMERCIAL_INICIO')) setHorarioComercialInicio(map.get('LARA_HORARIO_COMERCIAL_INICIO') || '8');
    if (map.get('LARA_HORARIO_COMERCIAL_FIM')) setHorarioComercialFim(map.get('LARA_HORARIO_COMERCIAL_FIM') || '18');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configData]);

  const mutation = useMutation({
    mutationFn: saveConfiguracoes,
  });

  const onSave = () => {
    mutation.mutate([
      { chave: 'LARA_ASSINATURA', valor: assinatura, descricao: 'Nome da assistente virtual' },
      { chave: 'LARA_EMPRESA_NOME', valor: empresa, descricao: 'Nome exibido da empresa' },
      { chave: 'LARA_PIX_CHAVE', valor: pixChave, descricao: 'Chave PIX padrao' },
      { chave: 'LARA_BASE_BOLETO_URL', valor: boletoBaseUrl, descricao: 'URL base para boleto' },
      { chave: 'JANELA_RESPOSTA_SEM_IDENTIFICACAO_MIN', valor: cooldownMin, descricao: 'Janela sem pedir identificacao novamente' },
      { chave: 'JANELA_CONTEXTO_HORAS', valor: janelaContextoHoras, descricao: 'Janela de contexto de regua ativa' },
      { chave: 'LARA_HORARIO_INICIO', valor: inicioDisparo, descricao: 'Horario inicio disparos' },
      { chave: 'LARA_HORARIO_FIM', valor: fimDisparo, descricao: 'Horario fim disparos' },
      ...alertContatos.flatMap((c, i) => [
        { chave: `LARA_ALERT_CONTATO_${i + 1}_NOME`, valor: c.nome, descricao: `Nome do contato de alerta ${i + 1}` },
        { chave: `LARA_ALERT_CONTATO_${i + 1}_NUMERO`, valor: c.numero, descricao: `Numero do contato de alerta ${i + 1}` },
      ]),
      { chave: 'LARA_SLA_NIVEL1_MIN', valor: slaNivel1Min, descricao: 'Minutos sem atendimento para alertar supervisor' },
      { chave: 'LARA_SLA_NIVEL2_MIN', valor: slaNivel2Min, descricao: 'Minutos sem atendimento para alertar gerente' },
      { chave: 'LARA_SLA_GERENTE_REPEAT_MIN', valor: slaGerenteRepeatMin, descricao: 'Intervalo repeticao alerta gerente' },
      { chave: 'LARA_SLA_SUPERVISOR_NOME', valor: slaSupervisorNome, descricao: 'Nome do supervisor SLA' },
      { chave: 'LARA_SLA_SUPERVISOR_NUMERO', valor: slaSupervisorNumero, descricao: 'WhatsApp do supervisor SLA' },
      { chave: 'LARA_SLA_GERENTE_NOME', valor: slaGerenteNome, descricao: 'Nome do gerente SLA' },
      { chave: 'LARA_SLA_GERENTE_NUMERO', valor: slaGerenteNumero, descricao: 'WhatsApp do gerente SLA' },
      { chave: 'LARA_HORARIO_COMERCIAL_INICIO', valor: horarioComercialInicio, descricao: 'Hora inicio horario comercial' },
      { chave: 'LARA_HORARIO_COMERCIAL_FIM', valor: horarioComercialFim, descricao: 'Hora fim horario comercial' },
    ]);
  };

  const updateAlertContato = (idx: number, field: keyof AlertContato, value: string) => {
    setAlertContatos(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  return (
    <LaraLayout>
      <PageHeader
        title="Configurações"
        subtitle="Parâmetros gerais, canais, integrações, segurança e ambiente."
        actions={<Badge variant="outline" className="text-xs">Integrado com backend</Badge>}
      />

      <div className="max-w-3xl space-y-8">
        <section className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Dados da Empresa</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Nome / Assinatura da Lara</Label>
              <Input value={assinatura} onChange={(e) => setAssinatura(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">Empresa</Label>
              <Input value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="mt-1.5" />
            </div>
          </div>
        </section>

        <Separator />

        <section className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Pagamento</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Chave PIX</Label>
              <Input type="password" value={pixChave} onChange={(e) => setPixChave(e.target.value)} className="mt-1.5" autoComplete="off" />
            </div>
            <div>
              <Label className="text-xs">URL Base do Boleto</Label>
              <Input value={boletoBaseUrl} onChange={(e) => setBoletoBaseUrl(e.target.value)} className="mt-1.5" />
            </div>
          </div>
        </section>

        <Separator />

        <section className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Régua Ativa</h3>
          <div className="space-y-4">
            {['D-3', 'D0', 'D+3', 'D+7', 'D+15', 'D+30'].map(etapa => (
              <div key={etapa} className="flex items-center justify-between py-2 px-3 rounded-md border">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-bold text-foreground w-10">{etapa}</span>
                  <span className="text-xs text-muted-foreground">Disparo automático</span>
                </div>
                <Switch defaultChecked />
              </div>
            ))}
          </div>
        </section>

        <Separator />

        <section className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Operação</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Cooldown entre mensagens (minutos)</Label>
              <Input type="number" value={cooldownMin} onChange={(e) => setCooldownMin(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">Janela de contexto da régua (horas)</Label>
              <Input type="number" value={janelaContextoHoras} onChange={(e) => setJanelaContextoHoras(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">Horário de início dos disparos</Label>
              <Input type="time" value={inicioDisparo} onChange={(e) => setInicioDisparo(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">Horário de fim dos disparos</Label>
              <Input type="time" value={fimDisparo} onChange={(e) => setFimDisparo(e.target.value)} className="mt-1.5" />
            </div>
          </div>
        </section>

        <Separator />

        <section className="rounded-lg border bg-card p-6">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-foreground">Alertas de Escalação Humana</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Até 3 atendentes que recebem alerta imediato no WhatsApp quando um cliente precisa de atendimento humano.
            </p>
          </div>
          <div className="space-y-3">
            {alertContatos.map((contato, idx) => (
              <div key={idx} className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-md border bg-muted/30">
                <div>
                  <Label className="text-xs text-muted-foreground">Nome {idx + 1}</Label>
                  <Input
                    placeholder="Ex: Gerente Financeiro"
                    value={contato.nome}
                    onChange={e => updateAlertContato(idx, 'nome', e.target.value)}
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">WhatsApp {idx + 1} <span className="text-muted-foreground">(com DDI, ex: 5592999999999)</span></Label>
                  <Input
                    placeholder="5592999999999"
                    value={contato.numero}
                    onChange={e => updateAlertContato(idx, 'numero', e.target.value.replace(/\D/g, ''))}
                    className="mt-1.5"
                    maxLength={15}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <Separator />

        <section className="rounded-lg border bg-card p-6">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-foreground">SLA de Atendimento Humano</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Escalação automática quando um atendimento não é assumido dentro do prazo. Fora do horário comercial o clock SLA é pausado.
            </p>
          </div>

          {/* Fluxo visual */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-6 p-3 rounded-md bg-muted/40 border text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Fluxo:</span>
            <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-medium">Novo caso</span>
            <span>→ alerta Nível 1 (atendentes)</span>
            <span className="px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 font-medium">+{slaNivel1Min}min → Supervisor</span>
            <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 font-medium">+{slaNivel2Min}min → Gerente (repete a cada {slaGerenteRepeatMin}min)</span>
          </div>

          {/* Horário comercial */}
          <div className="mb-5">
            <Label className="text-xs font-semibold text-foreground">Horário Comercial (clock SLA pausa fora deste período)</Label>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <Label className="text-xs text-muted-foreground">Hora início (0–23)</Label>
                <Input
                  type="number"
                  min={0} max={23}
                  value={horarioComercialInicio}
                  onChange={e => setHorarioComercialInicio(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Hora fim (0–23)</Label>
                <Input
                  type="number"
                  min={0} max={23}
                  value={horarioComercialFim}
                  onChange={e => setHorarioComercialFim(e.target.value)}
                  className="mt-1.5"
                />
              </div>
            </div>
          </div>

          {/* Nível 2 — Supervisor */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-yellow-100 text-yellow-800">Nível 2 — Supervisor</span>
              <span className="text-xs text-muted-foreground">Alerta enviado após</span>
              <Input
                type="number"
                min={5}
                value={slaNivel1Min}
                onChange={e => setSlaNivel1Min(e.target.value)}
                className="w-20 h-7 text-xs"
              />
              <span className="text-xs text-muted-foreground">minutos sem atendimento</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-md border bg-yellow-50/40">
              <div>
                <Label className="text-xs text-muted-foreground">Nome do Supervisor</Label>
                <Input
                  placeholder="Ex: Carlos Supervisor"
                  value={slaSupervisorNome}
                  onChange={e => setSlaSupervisorNome(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">WhatsApp do Supervisor (com DDI)</Label>
                <Input
                  placeholder="5592999999999"
                  value={slaSupervisorNumero}
                  onChange={e => setSlaSupervisorNumero(e.target.value.replace(/\D/g, ''))}
                  className="mt-1.5"
                  maxLength={15}
                />
              </div>
            </div>
          </div>

          {/* Nível 3 — Gerente */}
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800">Nível 3 — Gerente</span>
              <span className="text-xs text-muted-foreground">Alerta após</span>
              <Input
                type="number"
                min={10}
                value={slaNivel2Min}
                onChange={e => setSlaNivel2Min(e.target.value)}
                className="w-20 h-7 text-xs"
              />
              <span className="text-xs text-muted-foreground">min, repete a cada</span>
              <Input
                type="number"
                min={5}
                value={slaGerenteRepeatMin}
                onChange={e => setSlaGerenteRepeatMin(e.target.value)}
                className="w-20 h-7 text-xs"
              />
              <span className="text-xs text-muted-foreground">min até ser assumido</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-md border bg-red-50/40">
              <div>
                <Label className="text-xs text-muted-foreground">Nome do Gerente</Label>
                <Input
                  placeholder="Ex: João Gerente"
                  value={slaGerenteNome}
                  onChange={e => setSlaGerenteNome(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">WhatsApp do Gerente (com DDI)</Label>
                <Input
                  placeholder="5592999999999"
                  value={slaGerenteNumero}
                  onChange={e => setSlaGerenteNumero(e.target.value.replace(/\D/g, ''))}
                  className="mt-1.5"
                  maxLength={15}
                />
              </div>
            </div>
          </div>
        </section>

        <div className="flex justify-end pb-6">
          <Button onClick={onSave}>{mutation.isPending ? 'Salvando...' : 'Salvar Configurações'}</Button>
        </div>
      </div>
    </LaraLayout>
  );
}
