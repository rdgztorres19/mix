// PRUEBA SUPER SIMPLE PARA VS CODE DEBUG
console.log('========================================');
console.log('🚀 PRUEBA VS CODE DEBUG - INICIANDO');
console.log('========================================');

// ESTE DEBUGGER DEBE PAUSAR INMEDIATAMENTE
debugger; // 🔴 SI NO PARA AQUI = VS CODE DEBUGGING NO FUNCIONA

console.log('❌ SI VES ESTE MENSAJE, DEBUGGING NO ESTÁ FUNCIONANDO');
console.log('💡 El debugger no paró el script');

// Segundo intento
console.log('Configurando segundo breakpoint...');
debugger; // 🔴 SEGUNDO INTENTO

console.log('❌ DEBUGGING DEFINITIVAMENTE NO FUNCIONA EN VS CODE');
console.log('📝 Usaremos método alternativo...');

process.exit(0);