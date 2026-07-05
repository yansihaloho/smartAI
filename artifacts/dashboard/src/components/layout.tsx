import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ThemeProvider } from "@/components/theme-provider";
import {
  Activity, BarChart3, BrainCircuit, Calendar, Cpu,
  History, LayoutDashboard, LineChart, Menu, X,
} from "lucide-react";
import { useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";

const links = [
  { href: "/",          label: "Overview",          icon: LayoutDashboard },
  { href: "/results",   label: "Hasil Undian",       icon: History        },
  { href: "/prediksi",  label: "Prediksi AI",        icon: BrainCircuit   },
  { href: "/smart-ai",  label: "Smart AI",           icon: Cpu            },
  { href: "/deep",      label: "Analisis Mendalam",  icon: Activity       },
  { href: "/laporan",   label: "Laporan Akurasi",    icon: BarChart3      },
  { href: "/daily",     label: "Laporan Harian",     icon: Calendar       },
  { href: "/learning",  label: "Self-Learning",      icon: LineChart      },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  return (
    <nav className="flex flex-col gap-0.5 p-3 flex-1 overflow-y-auto">
      {links.map(({ href, label, icon: Icon }) => {
        const active = location === href;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand({ status }: { status?: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
      <div className="bg-primary/20 p-2 rounded-lg shrink-0">
        <BrainCircuit className="w-5 h-5 text-primary" />
      </div>
      <div className="min-w-0">
        <h1 className="font-bold text-base leading-tight tracking-tight truncate">Smart AI Togel</h1>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              status === "ok" ? "bg-green-500" : "bg-yellow-500 animate-pulse"
            }`}
          />
          {status === "ok" ? "Engine Online" : "Connecting…"}
        </p>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: health } = useHealthCheck({
    query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30000 },
  });

  return (
    <ThemeProvider defaultTheme="dark" storageKey="smart-ai-theme">
      <div className="flex h-screen w-full bg-background overflow-hidden">
        {/* ─── Desktop sidebar ─── */}
        <aside className="hidden md:flex w-60 xl:w-64 border-r border-border bg-card flex-col h-full shrink-0">
          <Brand status={health?.status} />
          <NavLinks />
          <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
            v2.5.0 · Macau Engine
          </div>
        </aside>

        {/* ─── Mobile drawer overlay ─── */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* ─── Mobile drawer ─── */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-72 border-r border-border bg-card flex flex-col transition-transform duration-300 md:hidden ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between pr-3">
            <Brand status={health?.status} />
            <button
              onClick={() => setMobileOpen(false)}
              className="p-2 rounded-lg hover:bg-secondary text-muted-foreground"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <NavLinks onNavigate={() => setMobileOpen(false)} />
          <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
            v2.5.0 · Macau Engine
          </div>
        </aside>

        {/* ─── Main content ─── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Mobile top bar */}
          <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-lg hover:bg-secondary text-muted-foreground"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-primary" />
              <span className="font-bold text-sm">Smart AI Togel</span>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="relative min-h-full">
              <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent" />
              <div className="relative p-4 md:p-6 lg:p-8 w-full max-w-[1600px] mx-auto">
                {children}
              </div>
            </div>
          </div>
        </main>
      </div>
    </ThemeProvider>
  );
}
