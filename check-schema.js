const { pool } = require('./config/database');

async function checkSchema() {
    try {
        // Check family_member table structure
        const [familyMemberSchema] = await pool.execute('DESCRIBE family_member');
        console.log('\n=== FAMILY_MEMBER TABLE STRUCTURE ===');
        console.log(familyMemberSchema);

        // Check caregiver table structure
        const [caregiverSchema] = await pool.execute('DESCRIBE caregiver');
        console.log('\n=== CAREGIVER TABLE STRUCTURE ===');
        console.log(caregiverSchema);

        // Check care_recipient table structure
        const [careRecipientSchema] = await pool.execute('DESCRIBE care_recipient');
        console.log('\n=== CARE_RECIPIENT TABLE STRUCTURE ===');
        console.log(careRecipientSchema);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        process.exit(0);
    }
}

checkSchema();
