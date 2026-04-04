import { TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';

export function SidebarHeader() {
  return (
    <div className="mb-3.5">
      <div className="flex items-center gap-2.5 px-3.5 h-[70px]">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="size-[42px] rounded-xl bg-primary/10 flex items-center justify-center">
            <TrendingUp className="size-6 text-primary" />
          </div>
          <div>
            <span className="text-mono font-semibold text-sm">Small Caps</span>
            <span className="block text-xs text-muted-foreground">Signal Generator</span>
          </div>
        </Link>
      </div>
    </div>
  );
}
