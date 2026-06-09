import {
  Activity,
  BarChart3,
  CalendarClock,
  FileText,
  FolderOpen,
  HandshakeIcon,
  Headphones,
  LayoutDashboard,
  MessageSquare,
  MessagesSquare,
  ScrollText,
  Settings,
  ShieldBan,
  SlidersHorizontal,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const groups = [
  {
    label: "Operação",
    items: [
      { title: "Dashboard", url: "/lara/dashboard", icon: LayoutDashboard },
      { title: "Atendimentos", url: "/lara/atendimentos", icon: MessageSquare },
      { title: "Conversas", url: "/lara/conversas", icon: MessagesSquare },
      { title: "Clientes", url: "/lara/clientes", icon: Users },
      { title: "Títulos", url: "/lara/titulos", icon: FileText },
      { title: "Promessas", url: "/lara/promessas", icon: CalendarClock },
      { title: "Atendimento Humano", url: "/lara/atendimento-humano", icon: Headphones },
    ],
  },
  {
    label: "Régua",
    items: [
      { title: "Régua Ativa", url: "/lara/regua-ativa", icon: Zap },
      { title: "Parametrização", url: "/lara/regua-config", icon: SlidersHorizontal },
      { title: "Negociação", url: "/lara/negociacao", icon: HandshakeIcon },
    ],
  },
  {
    label: "Inteligência",
    items: [
      { title: "Dashboard Preditivo", url: "/lara/dashboard-preditivo", icon: TrendingUp },
      { title: "Feedback & Insights", url: "/lara/feedback", icon: BarChart3 },
    ],
  },
  {
    label: "Sistema",
    items: [
      { title: "Cases", url: "/lara/cases", icon: FolderOpen },
      { title: "Opt-out", url: "/lara/optout", icon: ShieldBan },
      { title: "Logs e Auditoria", url: "/lara/logs", icon: ScrollText },
      { title: "Configurações", url: "/lara/configuracoes", icon: Settings },
      { title: "Monitoramento", url: "/lara/monitoramento", icon: Activity },
    ],
  },
];

export function LaraSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const currentPath = location.pathname;

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className={`px-4 py-5 ${collapsed ? "px-2" : ""}`}>
          {!collapsed ? (
            <div>
              <h2 className="text-base font-bold tracking-tight text-sidebar-primary-foreground">Lara</h2>
              <p className="mt-0.5 text-[10px] uppercase tracking-widest text-sidebar-foreground/60">
                Cobrança Inteligente
              </p>
            </div>
          ) : (
            <div className="flex justify-center">
              <span className="text-lg font-bold text-sidebar-primary-foreground">L</span>
            </div>
          )}
        </div>

        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/50">
              {!collapsed && group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = currentPath === item.url || currentPath.startsWith(`${item.url}/`);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={collapsed ? item.title : undefined}>
                        <NavLink
                          to={item.url}
                          className="hover:bg-sidebar-accent/80"
                          activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        >
                          <item.icon className="mr-2 h-4 w-4 shrink-0" />
                          {!collapsed && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
