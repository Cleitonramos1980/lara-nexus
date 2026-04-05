import { ReactNode } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { LaraSidebar } from './LaraSidebar';

interface LaraLayoutProps {
  children: ReactNode;
}

export function LaraLayout({ children }: LaraLayoutProps) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <LaraSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center border-b bg-card px-4 shrink-0">
            <SidebarTrigger className="mr-3" />
            <span className="text-xs text-muted-foreground font-medium">Lara | Cobrança Inteligente</span>
          </header>
          <main className="flex-1 overflow-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
