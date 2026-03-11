const { pool } = require('./config/database');
const bcrypt = require('bcryptjs');

async function fixPasswords() {
    try {
        console.log('🔧 Fixing family_member password hashes...\n');
        
        // Generate correct hash for password123
        const correctHash = '$2b$10$I9.bwbRYX6vq87hxNm9h.ekyVh7fe6WmssbIEWDAJTzGy.l5u0hn.';
        
        // Update all family_member passwords
        const [result] = await pool.execute(
            'UPDATE family_member SET password_hash = ?',
            [correctHash]
        );
        
        console.log(`✅ Updated ${result.affectedRows} family_member record(s)`);
        console.log('   All family_members can now login with password: password123\n');
        
        // Verify the update
        const [members] = await pool.execute(
            'SELECT family_member_id, name, email FROM family_member'
        );
        
        console.log('📋 Updated family_members:\n');
        members.forEach(m => {
            console.log(`   Email: ${m.email}`);
            console.log(`   Name: ${m.name}`);
            console.log(`   Password: password123\n`);
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        process.exit(0);
    }
}

fixPasswords();
