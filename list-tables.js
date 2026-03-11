const { pool } = require('./config/database');

async function listTables() {
    try {
        const [tables] = await pool.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()");
        console.log('\n=== TABLES IN DATABASE ===\n');
        tables.forEach(t => console.log(' -', t.TABLE_NAME));
        
        // Now describe each table
        for (const table of tables) {
            const [columns] = await pool.execute(`DESCRIBE ${table.TABLE_NAME}`);
            console.log(`\n=== ${table.TABLE_NAME.toUpperCase()} COLUMNS ===`);
            columns.forEach(col => {
                console.log(`  ${col.Field}: ${col.Type}${col.Null === 'NO' ? ' NOT NULL' : ''}`);
            });
        }
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

listTables();
