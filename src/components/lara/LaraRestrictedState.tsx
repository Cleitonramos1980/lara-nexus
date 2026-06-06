import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

type LaraRestrictedStateProps = {
  title?: string;
  description?: string;
};

export function LaraRestrictedState({
  title = "Acesso restrito",
  description = "Seu perfil não possui permissão visual para acessar esta rotina.",
}: LaraRestrictedStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <ShieldAlert className="mb-4 h-12 w-12 text-muted-foreground/40" />
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
