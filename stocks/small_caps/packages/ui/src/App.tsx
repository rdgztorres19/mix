import { ThemeProvider } from 'next-themes';
import { HelmetProvider } from 'react-helmet-async';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { AppLayout } from '@/components/layouts/app-layout';
import { ScreenerPage } from '@/pages/screener';
import { ChartPage } from '@/pages/chart';
import { SimulatorPage } from '@/pages/simulator';

export function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      storageKey="vite-theme"
      enableSystem
      disableTransitionOnChange
      enableColorScheme
    >
      <HelmetProvider>
        <HashRouter>
          <Toaster />
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Navigate to="/screener" replace />} />
              <Route path="/screener" element={<ScreenerPage />} />
              <Route path="/chart/:symbol/:date" element={<ChartPage />} />
              <Route path="/simulator/:symbol/:date" element={<SimulatorPage />} />
            </Route>
          </Routes>
        </HashRouter>
      </HelmetProvider>
    </ThemeProvider>
  );
}
