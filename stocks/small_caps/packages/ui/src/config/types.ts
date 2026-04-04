import { type LucideIcon } from 'lucide-react';

export interface MenuItem {
  title?: string;
  icon?: LucideIcon;
  path?: string;
  heading?: string;
  badge?: string;
}

export type MenuConfig = MenuItem[];
