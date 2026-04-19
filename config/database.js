const mysql = require('mysql2/promise');

// Don't load dotenv on Railway
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Create a connection pool
let pool;

// Check for Railway's DATABASE_URL first
if (process.env.DATABASE_URL) {
  console.log('📡 Using Railway database connection');
  pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
} else {
  // Local development
  console.log('💻 Using local database connection');
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'carezone_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
}

// Test database connection
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Database connected successfully');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
}

module.exports = { pool, testConnection };