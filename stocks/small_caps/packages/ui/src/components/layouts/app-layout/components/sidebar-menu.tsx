import { useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MENU_SIDEBAR } from '@/config/menu.config';
import type { MenuItem } from '@/config/types';
import { cn } from '@/lib/utils';

export function SidebarMenu() {
  const { pathname } = useLocation();

  const matchPath = useCallback(
    (path: string): boolean =>
      path === pathname || (path.length > 1 && pathname.startsWith(path)),
    [pathname],
  );

  return (
    <div className="grow overflow-y-auto max-h-[calc(100vh-11.5rem)]">
      <nav className="space-y-1 px-3.5">
        {MENU_SIDEBAR.map((item: MenuItem, index: number) => {
          if (item.heading) {
            return (
              <div key={index} className="uppercase text-xs font-medium text-muted-foreground/70 pt-4 pb-1 px-2">
                {item.heading}
              </div>
            );
          }
          const isActive = item.path ? matchPath(item.path) : false;
          return (
            <Link
              key={index}
              to={item.path || '/'}
              className={cn(
                'flex items-center gap-2 h-9 px-2 rounded-lg text-sm font-medium transition-colors border border-transparent',
                'text-accent-foreground hover:text-mono',
                isActive && 'bg-background border-border text-mono font-medium',
                !isActive && 'hover:bg-transparent',
              )}
            >
              {item.icon && <item.icon className="size-4 opacity-60" />}
              <span>{item.title}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
