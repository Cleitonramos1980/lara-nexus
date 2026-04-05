import { LaraLayout } from '@/components/lara/LaraLayout';
import { PageHeader } from '@/components/lara/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

export default function LaraConfiguracoes() {
  return (
    <LaraLayout>
      <PageHeader
        title="Configurações"
        subtitle="Parâmetros da operação de cobrança"
        actions={<Badge variant="outline" className="text-xs">Preparado para integração</Badge>}
      />

      <div className="max-w-3xl space-y-8">
        {/* Dados da empresa */}
        <section className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Dados da Empresa</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Nome / Assinatura da Lara</Label>
              <Input defaultValue="Lara · Assistente Financeira" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">Empresa</Label>
              <Input defaultValue="Grupo Norte Distribuidora" className="mt-1.5" />
            </div>
          </div>
        </section>

        <Separator />

        {/* Pagamento */}
        <section className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Pagamento</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Chave PIX</Label>
              <Input defaultValue="financeiro@gruponorte.com.br" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">Nome do Recebedor</Label>
              <Input defaultValue="Grupo Norte Distribuidora Ltda" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">Banco</Label>
              <Input defaultValue="Banco do Brasil" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">Texto Padrão de Boleto</Label>
              <Input defaultValue="Segue o boleto atualizado para pagamento." className="mt-1.5" />
            </div>
          </div>
        </section>

        <Separator />

        {/* Régua Ativa */}
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

        {/* Operação */}
        <section className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Operação</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Cooldown entre mensagens (minutos)</Label>
              <Input type="number" defaultValue="30" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">Horário de início dos disparos</Label>
              <Input type="time" defaultValue="08:00" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">Horário de fim dos disparos</Label>
              <Input type="time" defaultValue="18:00" className="mt-1.5" />
            </div>
          </div>
        </section>

        <div className="flex justify-end pb-6">
          <Button>Salvar Configurações</Button>
        </div>
      </div>
    </LaraLayout>
  );
}
