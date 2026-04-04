import { SidebarHeader } from './sidebar-header';
import { SidebarMenu } from './sidebar-menu';
import { SidebarFooter } from './sidebar-footer';

export function Sidebar() {
  return (
    <div className="fixed top-0 bottom-0 z-20 lg:flex flex-col shrink-0 w-(--sidebar-width) bg-muted dark:bg-background">
      <SidebarHeader />
      <SidebarMenu />
      <SidebarFooter />
    </div>
  );
}
