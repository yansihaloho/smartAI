import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ThemeProvider } from "@/components/theme-provider";
import { Activity, BarChart3, BrainCircuit, Database, History, LayoutDashboard, LineChart, Cpu } from "lucide-react";
import { useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";

export function Sidebar() {
  const [location] = useLocation();
  const { data: health } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30000 }});

  const links = [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/results", label: "Hasil Undian", icon: History },
    { href: "/prediksi", label: "Prediksi AI", icon: BrainCircuit },
    { href: "/smart-ai", label: "Smart AI", icon: Cpu },
    { href: "/deep", label: "Analisis Mendalam", icon: Database },
    { href: "/laporan", label: "Laporan Akurasi", icon: BarChart3 },
    { href: "/learning", label: "Self-Learning", icon: LineChart },
  ];

  return (
    <div className="w-64 border-r bg-card flex flex-col h-full shrink-0">
      <div className="p-6 border-b flex items-center gap-3">
        <div className="bg-primary/20 p-2 rounded-md">
          <BrainCircuit className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="font-bold text-lg leading-tight tracking-tight">Smart AI Togel</h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${health?.status === 'ok' ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}></span>
            {health?.status === 'ok' ? 'Engine Online' : 'Connecting...'}
          </p>
        </div>
      </div>
      
      <nav className="p-4 flex-1 flex flex-col gap-1 overflow-y-auto">
        {links.map((link) => {
          const Icon = link.icon;
          const active = location === link.href;
          return (
            <Link key={link.href} href={link.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-sm font-medium ${active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`} data-testid={`nav-${link.label.toLowerCase().replace(/\s+/g, '-')}`}>
              <Icon className="w-4 h-4" />
              {link.label}
            </Link>
          );
        })}
      </nav>
      
      <div className="p-4 border-t text-xs text-muted-foreground">
        v2.4.0 (Macau Engine)
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="smart-ai-theme">
      <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/30">
        <Sidebar />
        <main className="flex-1 overflow-y-auto relative">
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background" />
          <div className="relative p-8 w-full max-w-[1600px] mx-auto min-h-full">
            {children}
          </div>
        </main>
      </div>
    </ThemeProvider>
  );
}
