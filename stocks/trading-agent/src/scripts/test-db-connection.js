/**
 * Test DB connection from remote PC.
 *
 * Usage:
 *   node test-db-connection.js                          # uses localhost
 *   node test-db-connection.js 192.168.1.100            # uses custom host
 *   MYSQL_HOST=192.168.1.100 node test-db-connection.js # via env var
 */

const mysql = require('mysql2/promise');

const host = process.argv[2] || process.env.MYSQL_HOST || 'localhost';
const port = parseInt(process.env.MYSQL_PORT || '3306', 10);
const user = process.env.MYSQL_USER || 'root';
const password = process.env.MYSQL_PASSWORD || 'sbrQp10';
const database = process.env.MYSQL_DATABASE_TRAINING || 'stock_training';

async function main() {
  console.log(`\n  Testing MySQL connection...`);
  console.log(`  Host: ${host}:${port}`);
  console.log(`  User: ${user}`);
  console.log(`  Database: ${database}\n`);

  try {
    const conn = await mysql.createConnection({ host, port, user, password, database });
    console.log('  ✓ Connected!\n');

    // Test tables
    const [tables] = await conn.query("SHOW TABLES");
    console.log(`  Tables: ${tables.map(t => Object.values(t)[0]).join(', ')}\n`);

    // Test screener_assets
    const [assets] = await conn.query("SELECT COUNT(*) as cnt FROM screener_assets WHERE status = 'active' AND tradable = 1");
    console.log(`  screener_assets (active): ${assets[0].cnt} symbols`);

    // Test stock_profile
    const [profiles] = await conn.query("SELECT COUNT(*) as cnt FROM stock_profile");
    console.log(`  stock_profile: ${profiles[0].cnt} rows`);

    await conn.end();
    console.log('\n  ✓ All good! DB is accessible.\n');
  } catch (err) {
    console.error(`\n  ✗ Connection failed: ${err.message}\n`);
    if (err.code === 'ECONNREFUSED') {
      console.error('  Hints:');
      console.error('  - Is MySQL running on the host?');
      console.error('  - Is the port open? (firewall)');
      console.error(`  - Try: mysql -h ${host} -P ${port} -u ${user} -p`);
    }
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('  Hints:');
      console.error(`  - Grant remote access: GRANT ALL ON ${database}.* TO '${user}'@'%' IDENTIFIED BY '***';`);
      console.error('  - MySQL bind-address must be 0.0.0.0 (not 127.0.0.1)');
    }
    process.exit(1);
  }
}

main();
