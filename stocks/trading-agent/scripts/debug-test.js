// Simple debugging test for VS Code F5
console.log('🚀 VS Code Debug Test Started');
debugger; // First stop point

const testValue = 'Hello World';
console.log('📝 Test value:', testValue);

debugger; // Second stop point

console.log('✅ Debug test completed');

setTimeout(() => {
  console.log('⏰ Timeout completed - ready to exit');
  process.exit(0);
}, 1000);