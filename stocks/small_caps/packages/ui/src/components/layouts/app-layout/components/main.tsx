import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { Header } from './header';
import { Sidebar } from './sidebar';

export function Main() {
  const isMobile = useIsMobile();

  useEffect(() => {
    const body = document.body;
    body.style.setProperty('--header-height', '60px');
    body.style.setProperty('--sidebar-width', '270px');
    body.classList.add('bg-muted');
    return () => {
      body.style.removeProperty('--header-height');
      body.style.removeProperty('--sidebar-width');
      body.classList.remove('bg-muted');
    };
  }, []);

  return (
    <div className="flex grow">
      {!isMobile && <Sidebar />}
      {isMobile && <Header />}
      <div className="flex flex-col lg:flex-row grow pt-(--header-height) lg:pt-0 min-w-0">
        <div className="flex flex-col grow min-w-0 items-stretch rounded-xl bg-background border border-input lg:ms-(--sidebar-width) mt-0 lg:mt-[15px] m-[15px]">
          <div className="flex flex-col grow min-w-0 overflow-y-auto overflow-x-hidden pt-5">
            <main className="grow min-w-0 pb-8" role="content">
              <Outlet />
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
