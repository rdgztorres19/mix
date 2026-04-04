import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

export function SidebarFooter() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center justify-between shrink-0 ps-4 pe-2 h-14">
      <span className="text-xs text-muted-foreground">Small Caps v1.0</span>
      <div className="flex items-center gap-0.5">
        <button
          className="cursor-pointer size-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-background hover:text-primary transition-colors"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </div>
  );
}
