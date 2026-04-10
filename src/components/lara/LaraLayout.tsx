import { type ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { FilialGlobalFilter } from "./FilialGlobalFilter";
import { LaraSidebar } from "./LaraSidebar";

type LaraLayoutProps = {
  children: ReactNode;
};

export function LaraLayout({ children }: LaraLayoutProps) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <LaraSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 items-center border-b bg-card px-4 shrink-0">
            <SidebarTrigger className="mr-3" />
            <span className="text-xs font-medium text-muted-foreground">Lara | Cobranca Inteligente</span>
            <div className="ml-auto">
              <FilialGlobalFilter />
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
