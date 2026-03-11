## 🛑 **Cómo poner Breakpoints y Debuggear**

### **1. Uso Rápido en VS Code**

1. **Abre** `fixed-sync-verification.js` en VS Code
2. **Haz click** en el margen izquierdo (número de línea) donde quieres pausar
3. **Verás un círculo rojo** = breakpoint activo
4. **Presiona F5** para empezar el debug

### **2. Breakpoints ya agregados en el código:**

- **🛑 BREAKPOINT 1**: Inicio de función `compareCandles()` (línea ~142)
- **🛑 BREAKPOINT 2**: Después del cálculo de cutoff time (línea ~165)  
- **🛑 BREAKPOINT 3**: Cuando encuentra un mismatch (línea ~202)
- **🛑 BREAKPOINT 4**: Después de obtener datos MySQL/MoMo (línea ~390)
- **🛑 BREAKPOINT 5**: Antes de hacer la comparación (línea ~401)

### **3. Comandos de Debug por Terminal:**

```bash
# Debug con Node.js inspector (pausa al inicio)
node --inspect-brk ./scripts/fixed-sync-verification.js CRCG

# Debug normal (no pausa al inicio) 
node --inspect ./scripts/fixed-sync-verification.js CRCG

# Debug con Chrome DevTools
# Después de ejecutar, ve a: chrome://inspect
```

### **4. Controles de Debug en VS Code:**

- **F5**: Continuar
- **F10**: Step Over (siguiente línea)
- **F11**: Step Into (entrar en función)
- **Shift+F11**: Step Out (salir de función)
- **Ctrl+Shift+F5**: Restart
- **Shift+F5**: Stop

### **5. Variables de Debug:**

Cuando esté pausado en un breakpoint, puedes inspeccionar:

- `mysqlCandles` - Datos de MySQL
- `momoCandles` - Datos de MoMo API
- `mysqlByMinute` - Map de velas MySQL por tiempo
- `momoByMinute` - Map de velas MoMo por tiempo
- `filteredMysqlTimes` - Tiempos filtrados MySQL
- `filteredMomoTimes` - Tiempos filtrados MoMo
- `cutoffTime` - Tiempo de corte usado
- `mismatchDetails` - Array de mismatches encontrados

### **6. Debug específico por tiempo:**

Para debuggear una vela específica, puedes agregar:

```javascript
if (timeKey === '2026-03-10 09:55') {
  debugger; // Para en esta vela específica
}
```

### **7. Watch Variables (Variables a observar):**

En VS Code, ve al panel **WATCH** y agrega:
- `mysqlRow`
- `momoCandle` 
- `openMatch`
- `highMatch`
- `lowMatch`
- `closeMatch`
- `volumeMatch`

### **8. Ejecutar paso a paso:**

```bash
# Con debug habilitado desde terminal
DEBUG=true node ./scripts/fixed-sync-verification.js CRCG
```

¡Ahora el script está listo para debugging completo! 🔍