const { pool } = require('./config/database');

async function fixSchema() {
    try {
        console.log('🔧 Fixing database schema...\n');

        // Make care_recipient_id nullable in family_member table
        await pool.execute(
            'ALTER TABLE family_member MODIFY care_recipient_id INT NULL'
        );
        console.log('✅ Updated family_member.care_recipient_id to allow NULL');

        console.log('\n✅ Schema fixes completed successfully!');
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        process.exit(0);
    }
}

fixSchema();
