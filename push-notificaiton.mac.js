const notifier = require('node-notifier');

notifier.notify({
  title: 'Proceso terminado1',
  message: 'Tu script terminó correctamente1',
  sound: true,
  timeout: 10,
  
});