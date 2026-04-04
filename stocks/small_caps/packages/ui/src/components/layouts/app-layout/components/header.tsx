import { useState, useEffect } from 'react';
import { TrendingUp, Menu } from 'lucide-react';
import { useLocation, Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { SidebarMenu } from './sidebar-menu';

export function Header() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => { setIsSidebarOpen(false); }, [pathname]);

  return (
    <header
      className={cn('header fixed top-0 z-10 end-0 flex items-stretch shrink-0 border-b border-border bg-background')}
      style={{ height: 'var(--header-height, 60px)', left: 0 }}
    >
      <div className="container-fluid flex justify-between items-stretch">
        <div className="flex items-center gap-2.5">
          <Link to="/" className="shrink-0 flex items-center gap-2">
            <TrendingUp className="size-5 text-primary" />
            <span className="font-semibold">Small Caps</span>
          </Link>
          <button className="p-2 text-muted-foreground/70" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            <Menu className="size-5" />
          </button>
        </div>
      </div>
      {isSidebarOpen && (
        <div className="absolute top-full left-0 right-0 bg-background border-b border-border p-4 shadow-lg">
          <SidebarMenu />
        </div>
      )}
    </header>
  );
}
