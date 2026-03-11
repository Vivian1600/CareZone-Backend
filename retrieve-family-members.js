const { pool } = require('./config/database');

async function retrieveFamilyMembers() {
    try {
        console.log('🔍 Retrieving all family members from database...\n');
        
        const [members] = await pool.execute(
            'SELECT family_member_id, name, email, contact_no, relationship, is_primary, created_at FROM family_member'
        );

        if (members.length === 0) {
            console.log('❌ No family members found in the database');
            return;
        }

        console.log(`✅ Found ${members.length} family member(s):\n`);
        console.log('╔════════════════════════════════════════════════════════════════╗');
        
        members.forEach((member, index) => {
            console.log('║');
            console.log(`║ #${index + 1} - ${member.name}`);
            console.log(`║ ├─ ID: ${member.family_member_id}`);
            console.log(`║ ├─ Email: ${member.email}`);
            console.log(`║ ├─ Phone: ${member.contact_no}`);
            console.log(`║ ├─ Relationship: ${member.relationship}`);
            console.log(`║ ├─ Primary: ${member.is_primary ? 'Yes' : 'No'}`);
            console.log(`║ └─ Created: ${member.created_at}`);
        });
        
        console.log('║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        // Test login with first family member
        if (members.length > 0) {
            console.log(`📝 You can use the following credentials to login:\n`);
            console.log(`   Email: ${members[0].email}`);
            console.log(`   (Use the password you set during registration)\n`);
        }

    } catch (error) {
        console.error('❌ Error retrieving family members:', error.message);
    } finally {
        process.exit(0);
    }
}

retrieveFamilyMembers();
