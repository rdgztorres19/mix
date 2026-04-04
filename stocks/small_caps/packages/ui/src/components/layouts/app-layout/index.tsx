import { Helmet } from 'react-helmet-async';
import { Main } from './components/main';

export function AppLayout() {
  return (
    <>
      <Helmet><title>Small Caps Signal Generator</title></Helmet>
      <Main />
    </>
  );
}
