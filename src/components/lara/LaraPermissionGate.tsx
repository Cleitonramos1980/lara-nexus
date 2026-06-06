import { type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { canAction, type LaraAction } from "@/components/lara/permissions";

type LaraPermissionGateProps = {
  rotina: string;
  action?: LaraAction;
  fallback?: ReactNode;
  children: ReactNode;
};

export function LaraPermissionGate({ rotina, action = "VISUALIZAR", fallback = null, children }: LaraPermissionGateProps) {
  return canAction(rotina, action) ? <>{children}</> : <>{fallback}</>;
}

export function DisabledTooltip({ message, children }: { message: string; children: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{children}</span>
        </TooltipTrigger>
        <TooltipContent>{message}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
