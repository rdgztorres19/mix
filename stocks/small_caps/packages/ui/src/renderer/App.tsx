import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layouts/AppLayout';
import { ScreenerPage } from './pages/ScreenerPage';
import { ChartPage } from './pages/ChartPage';
import { SimulatorPage } from './pages/SimulatorPage';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/screener" replace />} />
          <Route path="/screener" element={<ScreenerPage />} />
          <Route path="/chart/:symbol/:date" element={<ChartPage />} />
          <Route path="/simulator/:symbol/:date" element={<SimulatorPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
