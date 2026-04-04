import React from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { BarChart3, LineChart, Play } from 'lucide-react';

export function AppLayout() {
  return (
    <div className="flex h-screen bg-slate-950">
      {/* Sidebar */}
      <aside className="w-16 bg-slate-900 border-r border-slate-800 flex flex-col items-center py-4 gap-2">
        <div className="text-emerald-400 font-bold text-xs mb-4">SC</div>
        <SidebarLink to="/screener" icon={<BarChart3 size={20} />} label="Screener" />
        <SidebarLink to="/chart" icon={<LineChart size={20} />} label="Chart" />
        <SidebarLink to="/simulator" icon={<Play size={20} />} label="Simulator" />
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {/* Historical mode banner */}
        <div className="h-8 bg-amber-900/30 border-b border-amber-800/50 flex items-center justify-center">
          <span className="text-amber-400 text-xs font-medium tracking-wide uppercase">
            Historical Mode
          </span>
        </div>
        <div className="h-[calc(100vh-2rem)] overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function SidebarLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
          isActive
            ? 'bg-emerald-500/20 text-emerald-400'
            : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
        }`
      }
      title={label}
    >
      {icon}
    </NavLink>
  );
}
