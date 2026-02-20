const mysql = require('mysql2/promise');

async function connectAndQuery() {
  let connection;
  
  try {
    // Configuración de la conexión
    const connectionConfig = {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'sbrQp10',
      database: 'tree'
    };
    
    console.log('🔄 Conectando a la base de datos...');
    
    // Crear la conexión
    connection = await mysql.createConnection(connectionConfig);
    
    console.log('✅ Conectado a MySQL exitosamente');
    
    // Ejecutar la query
    const query = 'SELECT * FROM nodes';
    console.log(`🔍 Ejecutando query: ${query}`);
    
    const [rows, fields] = await connection.execute(query);
    
    // Imprimir la cantidad de elementos
    console.log(`📊 Cantidad de elementos en la tabla 'nodes': ${rows.length}`);
    
    // Opcional: mostrar algunos detalles adicionales
    if (rows.length > 0) {
      console.log(`📋 Estructura de la tabla:`);
      console.log(`   - Columnas: ${fields.map(field => field.name).join(', ')}`);
      console.log(`   - Primer registro:`, rows[0]);
    }
    
    // Calcular el peso de los datos en megabytes (método optimizado para grandes volúmenes)
    let totalSizeInBytes = 0;
    
    if (rows.length > 0) {
      // Calcular el tamaño promedio usando una muestra de registros
      const sampleSize = Math.min(100, rows.length);
      let sampleSizeInBytes = 0;
      
      for (let i = 0; i < sampleSize; i++) {
        const recordString = JSON.stringify(rows[i]);
        sampleSizeInBytes += Buffer.byteLength(recordString, 'utf8');
      }
      
      // Calcular el promedio por registro y multiplicar por el total
      const avgSizePerRecord = sampleSizeInBytes / sampleSize;
      totalSizeInBytes = avgSizePerRecord * rows.length;
      
      const sizeInKB = totalSizeInBytes / 1024;
      const sizeInMB = sizeInKB / 1024;
      const sizeInGB = sizeInMB / 1024;
      
      console.log(`\n💾 Análisis de tamaño de datos (estimado):`);
      console.log(`   - Bytes: ${Math.round(totalSizeInBytes).toLocaleString()}`);
      console.log(`   - Kilobytes: ${sizeInKB.toFixed(2)} KB`);
      console.log(`   - Megabytes: ${sizeInMB.toFixed(2)} MB`);
      console.log(`   - Gigabytes: ${sizeInGB.toFixed(4)} GB`);
      console.log(`   - Promedio por registro: ${avgSizePerRecord.toFixed(2)} bytes`);
      console.log(`   - Muestra utilizada: ${sampleSize} registros de ${rows.length} totales`);
    } else {
      console.log(`\n💾 No hay datos para calcular el tamaño`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    // Mensajes de error más específicos
    if (error.code === 'ECONNREFUSED') {
      console.error('💡 Verifica que MySQL esté corriendo en localhost:3306');
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('💡 Verifica las credenciales: usuario "root" y password "sbrQp10"');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      console.error('💡 Verifica que la base de datos "tree" exista');
    } else if (error.code === 'ER_NO_SUCH_TABLE') {
      console.error('💡 Verifica que la tabla "nodes" exista en la base de datos "tree"');
    }
    
  } finally {
    // Cerrar la conexión
    if (connection) {
      await connection.end();
      console.log('🔒 Conexión cerrada');
    }
  }
}

// Ejecutar la función
connectAndQuery();