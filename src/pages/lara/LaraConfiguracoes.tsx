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

export default function LaraConfiguracoes() {
  const [assinatura, setAssinatura] = useState('Lara · Assistente Financeira');
  const [empresa, setEmpresa] = useState('Grupo Norte Distribuidora');
  const [pixChave, setPixChave] = useState('financeiro@empresa.com.br');
  const [boletoBaseUrl, setBoletoBaseUrl] = useState('https://pagamentos.exemplo.local/boleto');
  const [cooldownMin, setCooldownMin] = useState('30');
  const [janelaContextoHoras, setJanelaContextoHoras] = useState('72');
  const [inicioDisparo, setInicioDisparo] = useState('08:00');
  const [fimDisparo, setFimDisparo] = useState('18:00');

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
    ]);
  };

  return (
    <LaraLayout>
      <PageHeader
        title="Configuracoes"
        subtitle="Parametros da operacao de cobranca"
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
              <Input value={pixChave} onChange={(e) => setPixChave(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">URL Base do Boleto</Label>
              <Input value={boletoBaseUrl} onChange={(e) => setBoletoBaseUrl(e.target.value)} className="mt-1.5" />
            </div>
          </div>
        </section>

        <Separator />

        <section className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Regua Ativa</h3>
          <div className="space-y-4">
            {['D-3', 'D0', 'D+3', 'D+7', 'D+15', 'D+30'].map(etapa => (
              <div key={etapa} className="flex items-center justify-between py-2 px-3 rounded-md border">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-bold text-foreground w-10">{etapa}</span>
                  <span className="text-xs text-muted-foreground">Disparo automatico</span>
                </div>
                <Switch defaultChecked />
              </div>
            ))}
          </div>
        </section>

        <Separator />

        <section className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Operacao</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Cooldown entre mensagens (minutos)</Label>
              <Input type="number" value={cooldownMin} onChange={(e) => setCooldownMin(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">Janela de contexto da regua (horas)</Label>
              <Input type="number" value={janelaContextoHoras} onChange={(e) => setJanelaContextoHoras(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">Horario de inicio dos disparos</Label>
              <Input type="time" value={inicioDisparo} onChange={(e) => setInicioDisparo(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">Horario de fim dos disparos</Label>
              <Input type="time" value={fimDisparo} onChange={(e) => setFimDisparo(e.target.value)} className="mt-1.5" />
            </div>
          </div>
        </section>

        <div className="flex justify-end pb-6">
          <Button onClick={onSave}>{mutation.isPending ? 'Salvando...' : 'Salvar Configuracoes'}</Button>
        </div>
      </div>
    </LaraLayout>
  );
}

