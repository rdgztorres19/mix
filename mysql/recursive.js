'use strict';

const mysql = require('mysql2/promise');

async function main() {
  let connection;

  const query = `
  WITH RECURSIVE cte AS (
    SELECT
      id,
      label,
      parent,
      type,
      params
    FROM nodes
    WHERE id = 1809577594105856

    UNION ALL

    SELECT
      n.id,
      n.label,
      n.parent,
      n.type,
      n.params
    FROM nodes n
    INNER JOIN cte ON n.parent = cte.id
    WHERE n.type IN (
      'generic',
      'device-v4',
      'assets-v4-collection',
      'assets-group',
      'asset-v4',
      'tgs-v4-collection',
      'tags-group-v4',
      'tag-v4'
    )
  )
  SELECT
    id,
    label,
    parent,
    type,
    params ->> '$."icon"' AS icon,
    params ->> '$."unit"' AS unit,
    params ->> '$."enabled"' AS enabled,
    params ->> '$."typeID"' AS typeID,
    params ->> '$."arrayItemsDataType"' AS arrayItemsDataType,
    params ->> '$."arrayLength"' AS arrayLength,
    params ->> '$."arraySavingMode"' AS arraySavingMode,
    params ->> '$."accessMode"' AS accessMode
  FROM cte
  WHERE type IN (
    'assets-group',
    'asset-v4',
    'tgs-v4-collection',
    'tags-group-v4',
    'tag-v4'
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