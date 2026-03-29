const { pool } = require('./config/database');

async function fixCaregiverColumn() {
    try {
        console.log('🔧 Fixing care_recipient.assigned_caregiver_id...');

        // Check if column exists
        const [columns] = await pool.execute("SHOW COLUMNS FROM care_recipient LIKE 'assigned_caregiver_id'");
        if (columns.length > 0) {
            console.log('✅ Column already exists');
            process.exit(0);
        }

        // Add column
        await pool.execute(
            "ALTER TABLE care_recipient ADD COLUMN assigned_caregiver_id INT NULL, ADD INDEX idx_assigned_caregiver (assigned_caregiver_id)"
        );
        console.log('✅ Added assigned_caregiver_id column with index');

        // Verify
        const [verify] = await pool.execute('DESCRIBE care_recipient');
        console.log('Updated structure:', verify.filter(c => c.Field === 'assigned_caregiver_id'));

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        process.exit(0);
    }
}

fixCaregiverColumn();

