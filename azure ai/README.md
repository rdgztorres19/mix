# Azure AI Projects App

Esta aplicación consume el endpoint de Azure AI usando los Microsoft Foundry SDKs en C#.

## Configuración

### Endpoint y Credenciales
- **Endpoint**: `https://rdgztorres19-2954-resource.services.ai.azure.com/api/projects/rdgztorres19-2954`
- **API Key**: Configurada en `appsettings.json`

### Paquetes Instalados
- `Azure.Identity` - Para autenticación
- `Azure.AI.Projects` - Cliente principal para proyectos de Azure AI
- `Azure.AI.Agents.Persistent` - Para agentes persistentes
- `Azure.AI.Inference` - Para inferencia de modelos (versión beta)

## Estructura del Proyecto

```
azure ai/
├── AzureAIApp/
│   ├── Program.cs          # Aplicación principal
│   ├── appsettings.json    # Configuración
│   └── AzureAIApp.csproj   # Archivo de proyecto
└── README.md               # Este archivo
```

## Cómo Ejecutar

### Prerequisitos
- .NET 9.0 SDK instalado
- Acceso al endpoint de Azure AI

### Pasos para ejecutar

1. **Navegar al directorio del proyecto**:
   ```bash
   cd "azure ai/AzureAIApp"
   ```

2. **Ejecutar la aplicación**:
   ```bash
   dotnet run
   ```

## Funcionalidades

La aplicación incluye:

1. **Conexión al Proyecto Azure AI**: Establece conexión usando las credenciales configuradas
2. **Cliente de Inferencia**: Prueba llamadas al servicio de inferencia de modelos
3. **Menú Interactivo**: Permite probar diferentes funcionalidades
4. **Manejo de Errores**: Captura y muestra errores de conexión o configuración

### Opciones del Menú

- **Opción 1**: Probar conexión al proyecto
- **Opción 2**: Listar información del proyecto  
- **Opción 3**: Salir de la aplicación

## Personalización

Para personalizar la aplicación:

1. **Modificar credenciales**: Editar `appsettings.json`
2. **Agregar nuevas funciones**: Extender la clase `Program` con nuevos métodos
3. **Configurar diferentes modelos**: Modificar el cliente de inferencia

## Troubleshooting

### Errores Comunes

1. **Error de autenticación**: Verificar que la API key sea válida
2. **Error de endpoint**: Confirmar que el endpoint esté disponible
3. **Error de inferencia**: Verificar que el modelo esté configurado en Azure AI

### Logs y Debugging

La aplicación muestra mensajes detallados de estado:
- ✅ Para operaciones exitosas
- ❌ Para errores  
- ⚠️ Para advertencias

## Próximos Pasos

Puedes extender esta aplicación para:
- Implementar diferentes tipos de agentes
- Conectar con bases de datos
- Agregar interfaces web o API
- Implementar procesamiento de archivos
- Integrar con otros servicios de Azure

## Soporte

Si tienes problemas con la aplicación, verifica:
1. La conectividad de red
2. Las credenciales de Azure
3. La configuración del proyecto en Azure AI Studio