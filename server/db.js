import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const poolConfig = {
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'maritime_platform',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: true,
};

if (process.env.DB_HOST && process.env.DB_HOST.startsWith('/cloudsql/')) {
  poolConfig.socketPath = process.env.DB_HOST;
} else {
  poolConfig.host = process.env.DB_HOST || 'localhost';
  poolConfig.port = parseInt(process.env.DB_PORT || '3306', 10);
}

const pool = mysql.createPool(poolConfig);

export default pool;
