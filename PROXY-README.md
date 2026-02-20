# Proxy Middleware Server

Este servidor proxy middleware redirige las peticiones al endpoint `/dashboard` hacia `https://platform.test.sorbapp.com/dashboard` agregando automáticamente el header de autorización Bearer.

## 🚀 Uso

### Iniciar el servidor
```bash
# Opción 1: Usando npm script
npm run proxy

# Opción 2: Directamente con node
node proxy-middleware.js
```

### Configuración
- **Puerto**: 3001 (por defecto) o usar variable de entorno `PORT`
- **Token**: Configurado directamente en el código
- **Endpoint**: `/dashboard` -> `https://platform.test.sorbapp.com/dashboard`

## 📋 Endpoints Disponibles

| Endpoint | Descripción |
|----------|-------------|
| `/dashboard` | Proxy hacia Grafana dashboard con autenticación |
| `/health` | Endpoint de salud del servidor |
| `/` | Información sobre el servidor |

## 🔧 Funcionalidades

- ✅ Proxy automático con http-proxy-middleware
- ✅ Inyección automática de Bearer token
- ✅ Logs detallados de las peticiones
- ✅ Manejo de errores
- ✅ CORS y SSL habilitados

## 📖 Ejemplo de uso

```bash
# 1. Iniciar el servidor proxy
npm run proxy

# 2. Acceder al dashboard a través del proxy
curl http://localhost:3001/dashboard

# 3. Verificar estado del servidor
curl http://localhost:3001/health
```

## 🔑 Autenticación

El servidor automáticamente agrega el header:
```
Authorization: Bearer ${GRAFANA_TOKEN}
```

## 🐛 Troubleshooting

Si hay problemas de conexión, verifica:
1. Que el servidor de destino esté disponible
2. Que el token de autorización sea válido
3. Que no haya problemas de firewall o proxy corporativo