const bcrypt = require('bcryptjs');

const storedHash = '$2a$10$N9qo8uLOickgx2ZMRZoMy.Mr.6lL8C/kJ6vH5Q7lV6K9Fz6Wp6NfK';
const testPassword = 'password123';

console.log('Testing password against stored hash...');
console.log('Stored hash:', storedHash);
console.log('Test password:', testPassword);
console.log('');

bcrypt.compare(testPassword, storedHash).then(result => {
    console.log('RESULT:', result);
    
    if (result) {
        console.log('✅ SUCCESS: Password matches!');
    } else {
        console.log('❌ FAILED: Password does NOT match');
        
        // Let's see what hash would be generated for this password
        return bcrypt.hash(testPassword, 10);
    }
}).then(newHash => {
    if (newHash) {
        console.log('');
        console.log('New hash for "password123" would be:');
        console.log(newHash);
        console.log('');
        console.log('Compare with stored hash:');
        console.log('Stored:', storedHash);
        console.log('New:   ', newHash);
        console.log('They are', storedHash === newHash ? 'IDENTICAL' : 'DIFFERENT');
    }
}).catch(err => {
    console.error('Error:', err);
});