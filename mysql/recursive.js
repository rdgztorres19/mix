'use strict';

const mysql = require('mysql2/promise');

async function main() {
  let connection;

  const query = `
    WITH RECURSIVE cte AS
      (
        SELECT id,
              label,
              parent,
              params ->> '$."type"' AS type,
              params ->> '$."icon"' AS icon,
              params ->> '$."unit"' AS unit,
              params ->> '$."enabled"' As enabled,
              params ->> '$."typeID"' As typeID,
              params ->> '$."arrayItemsDataType"' As arrayItemsDataType,
              params ->> '$."arrayLength"' As arrayLength,
              params ->> '$."arraySavingMode"' As arraySavingMode,
              params ->> '$."accessMode"' As accessMode
        FROM nodes
        WHERE id = 1809577594105856
      
        UNION ALL 
        
        SELECT n.id,
              n.label,
              n.parent,
              n.params ->> '$."type"' AS type,
              n.params ->> '$."icon"' AS icon,
              n.params ->> '$."unit"' AS unit,
              n.params ->> '$."enabled"' As enabled,
              n.params ->> '$."typeID"' As typeID,
              n.params ->> '$."arrayItemsDataType"' As arrayItemsDataType,
              n.params ->> '$."arrayLength"' As arrayLength,
              n.params ->> '$."arraySavingMode"' As arraySavingMode,
              n.params ->> '$."accessMode"' As accessMode
        FROM nodes n
        INNER JOIN cte ON n.parent = cte.id
        WHERE n.params ->> '$."type"' IN (
          "generic", 
          "device-v4",
          "assets-v4-collection",
          "assets-group",
          "asset-v4",
          "tgs-v4-collection",
          "tags-group-v4",
          "tag-v4"
        )
      )
      SELECT *
      FROM cte
      WHERE type IN (
        "assets-group",
        "asset-v4",
        "tgs-v4-collection",
        "tags-group-v4",
        "tag-v4"
      );
  `;

  try {
    connection = await mysql.createConnection({
      host: '192.168.1.149',
      user: 'root',
      password: 'sbrQp10',
      database: 'tree',
      port: 3306
    });

    console.log('Connected to MySQL.');

    console.time('query_execution');

    const [rows] = await connection.execute(query);

    console.timeEnd('query_execution');

    console.log(`Rows found: ${rows.length}`);
    // console.dir(rows, { depth: null, colors: true });

  } catch (error) {
    console.error('Error executing query:');
    console.error(error.message);
    if (error.sqlMessage) console.error('SQL Message:', error.sqlMessage);
    if (error.sql) console.error('SQL:', error.sql);
    process.exitCode = 1;
  } finally {
    if (connection) {
      await connection.end();
      console.log('Connection closed.');
    }
  }
}

main();