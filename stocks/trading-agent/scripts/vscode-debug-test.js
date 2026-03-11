console.log('📋 VS Code Debug Diagnostic');
console.log('Node.js version:', process.version);
console.log('Current working directory:', process.cwd());
console.log('Script path:', __filename);
console.log('Arguments:', process.argv);

debugger; // 🛑 PRIMER BREAKPOINT - Si VS Code no para aquí, hay problema de configuración

console.log('✅ First breakpoint passed - VS Code debugging is working!');

const testData = {
    symbols: ['TEST'],
    timestamp: new Date().toISOString(),
    debugging: true
};

console.log('📊 Test data:', testData);

debugger; // 🛑 SEGUNDO BREAKPOINT - Inspecciona testData en la ventana Variables

console.log('✅ Second breakpoint passed');
console.log('🎯 If you see this in VS Code Debug Console, debugging is working correctly!');

// Simulate a small async operation
setTimeout(() => {
    console.log('⏰ Timeout completed');
    debugger; // 🛑 TERCER BREAKPOINT - En operación async
    console.log('✅ All breakpoints working - VS Code debugging is ready!');
}, 500);