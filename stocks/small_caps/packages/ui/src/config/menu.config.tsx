import { BarChart3, Settings } from 'lucide-react';
import type { MenuItem } from '@/config/types';

export const MENU_SIDEBAR: MenuItem[] = [
  {
    title: 'Screener',
    icon: BarChart3,
    path: '/screener',
  },
  { heading: 'System' },
  {
    title: 'Settings',
    icon: Settings,
    path: '/settings',
  },
];
