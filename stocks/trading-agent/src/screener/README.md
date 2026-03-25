# Screener Module

Este módulo fue movido desde `stocks/screener/` a `src/screener/` para integrarse correctamente con NestJS.

- Todos los imports relativos funcionarán igual en desarrollo y producción.
- Registra `ScreenerModule` en tu `AppModule` así:

```ts
import { ScreenerModule } from './screener/screener.module';
```
