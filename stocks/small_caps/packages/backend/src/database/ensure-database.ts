import * as mysql from 'mysql2/promise';

interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Ensures the MySQL database exists, creating it if necessary.
 * Runs before TypeORM connects.
 */
export async function ensureDatabaseExists(config: DbConfig): Promise<void> {
  console.log(`Connecting to MySQL at ${config.host}:${config.port} as ${config.user}...`);
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    connectTimeout: 5000,
  });

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    console.log(`Database '${config.database}' ready`);
  } finally {
    await connection.end();
  }
}
