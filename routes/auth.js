// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { validateLogin, validateRegister, handleValidationErrors } = require('../middleware/validate');

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user (family_member or caregiver only)
 * @access  Public
 */
router.post('/register', validateRegister, handleValidationErrors, async (req, res, next) => {
    try {
        const { name, email, phone, password, role, address, type } = req.body;

        console.log('=================================');
        console.log('📝 REGISTER ATTEMPT');
        console.log('Name:', name);
        console.log('Email:', email);
        console.log('Role:', role);
        console.log('=================================');

        // Check if user already exists in respective table
        let existing = [];
        
        if (role === 'family_member') {
            [existing] = await pool.execute(
                'SELECT family_member_id FROM family_member WHERE email = ?',
                [email]
            );
        } else if (role === 'caregiver') {
            [existing] = await pool.execute(
                'SELECT caregiver_id FROM caregiver WHERE email = ?',
                [email]
            );
        } else {
            console.log('❌ Invalid role:', role);
            return res.status(400).json({
                success: false,
                message: 'Invalid role. Must be family_member or caregiver'
            });
        }

        if (existing.length > 0) {
            console.log('❌ User already exists with email:', email);
            return res.status(400).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        let result;
        let userId;
        
        // Insert into appropriate table
        if (role === 'family_member') {
            [result] = await pool.execute(
                `INSERT INTO family_member (name, email, contact_no, password_hash, relationship, is_primary) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [name, email, phone, password_hash, 'self', true]
            );
            userId = result.insertId;
            console.log('✅ Family member created with ID:', userId);
        } else if (role === 'caregiver') {
            [result] = await pool.execute(
                `INSERT INTO caregiver (name, email, phone_no, password_hash, address, type) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [name, email, phone, password_hash, address || null, type || 'volunteer']
            );
            userId = result.insertId;
            console.log('✅ Caregiver created with ID:', userId);
        }

        // Generate JWT token
        const token = jwt.sign(
            { id: userId, role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE || '7d' }
        );

        console.log('✅ Registration successful for:', name);
        console.log('=================================');

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            token,
            user: {
                id: userId,
                name,
                email,
                role
            }
        });
    } catch (error) {
        console.error('❌ Registration error:', error);
        next(error);
    }
});

/**
 * @route   POST /api/auth/register/caregiver
 * @desc    Register a new caregiver
 * @access  Public
 */
router.post('/register/caregiver', async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const { 
            name, email, phone, password, 
            address, type, availability 
        } = req.body;

        console.log('=================================');
        console.log('📝 CAREGIVER REGISTRATION ATTEMPT');
        console.log('Name:', name);
        console.log('Email:', email);
        console.log('Availability:', availability);
        console.log('=================================');

        // Check if user already exists
        const [existing] = await connection.execute(
            'SELECT caregiver_id FROM caregiver WHERE email = ?',
            [email]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // Convert availability to JSON object if it's a string
        let availabilityJson = null;
        if (availability) {
            // If it's a simple string like "Weekdays", convert to proper JSON
            if (typeof availability === 'string') {
                availabilityJson = JSON.stringify({ days: availability });
            } else {
                availabilityJson = JSON.stringify(availability);
            }
        }

        // Insert into caregiver table - matching your columns
        const [result] = await connection.execute(
            `INSERT INTO caregiver 
             (name, email, phone_no, password_hash, address, type, availability, is_active) 
             VALUES (?, ?, ?, ?, ?, ?, ?, true)`,
            [name, email, phone, password_hash, address || null, type || 'volunteer', availabilityJson]
        );

        await connection.commit();

        // Generate JWT token for auto-login
        const token = jwt.sign(
            { id: result.insertId, role: 'caregiver' },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE || '7d' }
        );

        console.log('✅ Caregiver registered with ID:', result.insertId);
        console.log('=================================');

        res.status(201).json({
            success: true,
            message: 'Caregiver registered successfully',
            token,
            user: {
                id: result.insertId,
                name,
                email,
                phone,
                role: 'caregiver'
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Caregiver registration error:', error);
        next(error);
    } finally {
        connection.release();
    }
});

/**
 * @route   POST /api/auth/register/family
 * @desc    Register a new family member with optional care recipient
 * @access  Public
 */
router.post('/register/family', async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const { 
            name, email, phone, password, 
            relationship,
            addRecipientNow,
            recipient 
        } = req.body;

        console.log('=================================');
        console.log('📝 FAMILY MEMBER REGISTRATION ATTEMPT');
        console.log('Name:', name);
        console.log('Email:', email);
        console.log('Add recipient now:', addRecipientNow);
        console.log('=================================');

        // Check if user already exists
        const [existing] = await connection.execute(
            'SELECT family_member_id FROM family_member WHERE email = ?',
            [email]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // Insert into family_member table
        const [familyResult] = await connection.execute(
            `INSERT INTO family_member 
             (name, email, contact_no, password_hash, relationship, is_primary) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [name, email, phone, password_hash, relationship, true]
        );

        const familyMemberId = familyResult.insertId;
        console.log('✅ Family member created with ID:', familyMemberId);

        // If user wants to add a care recipient now
        let careRecipientId = null;
        if (addRecipientNow && recipient) {
            console.log('📝 Adding care recipient:', recipient.name);
            
            // Insert care recipient WITHOUT registered_by column
            const [recipientResult] = await connection.execute(
                `INSERT INTO care_recipient 
                 (name, date_of_birth, gender, address, contact_no,
                  emergency_contact_name, emergency_contact_phone, medical_notes, 
                   status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
                [
                    recipient.name,
                    recipient.date_of_birth,
                    recipient.gender,
                    recipient.address || null,
                    recipient.phone || null,
                    recipient.emergency_contact_name,
                    recipient.emergency_contact_phone,
                    recipient.medical_notes || null,
                ]
            );
            
            careRecipientId = recipientResult.insertId;
            console.log('✅ Care recipient created with ID:', careRecipientId);

            // Create family link
            await connection.execute(
                `INSERT INTO family_links (family_member_id, care_recipient_id, relationship, is_primary) 
                 VALUES (?, ?, ?, true)`,
                [familyMemberId, careRecipientId, relationship]
            );
            console.log('✅ Family link created');
        }

        await connection.commit();

        // Generate JWT token for auto-login
        const token = jwt.sign(
            { id: familyMemberId, role: 'family_member' },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE || '7d' }
        );

        console.log('✅ Family member registration complete');
        console.log('=================================');

        res.status(201).json({
            success: true,
            message: 'Family member registered successfully',
            token,
            user: {
                id: familyMemberId,
                name,
                email,
                phone,
                role: 'family_member'
            },
            careRecipientAdded: !!careRecipientId,
            careRecipientId
        });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Family member registration error:', error);
        next(error);
    } finally {
        connection.release();
    }
});

/**
 * @route   POST /api/auth/login
 * @desc    Login user (checks all tables)
 * @access  Public
 */
router.post('/login', validateLogin, handleValidationErrors, async (req, res, next) => {
    try {
        const { email, password } = req.body;
        
        console.log('=================================');
        console.log('🔍 LOGIN ATTEMPT');
        console.log('Email:', email);
        console.log('Password length:', password.length);
        console.log('Timestamp:', new Date().toISOString());
        console.log('=================================');
        
        let user = null;
        let userTable = null;

        // Check family_member table
        console.log('🔎 Checking family_member table...');
        const [familyMembers] = await pool.execute(
            'SELECT family_member_id as id, name, email, contact_no as phone, password_hash, "family_member" as role FROM family_member WHERE email = ?',
            [email]
        );
        console.log('📊 Family members found:', familyMembers.length);

        if (familyMembers.length > 0) {
            user = familyMembers[0];
            userTable = 'family_member';
            console.log('✅ Found in family_member table');
            console.log('   Name:', user.name);
            console.log('   ID:', user.id);
        }

        // Check caregiver table if not found
        if (!user) {
            console.log('🔎 Checking caregiver table...');
            const [caregivers] = await pool.execute(
                'SELECT caregiver_id as id, name, email, phone_no as phone, password_hash, "caregiver" as role FROM caregiver WHERE email = ?',
                [email]
            );
            console.log('📊 Caregivers found:', caregivers.length);
            
            if (caregivers.length > 0) {
                user = caregivers[0];
                userTable = 'caregiver';
                console.log('✅ Found in caregiver table');
                console.log('   Name:', user.name);
                console.log('   ID:', user.id);
            }
        }

        // Check care_recipient table if not found
        if (!user) {
            console.log('🔎 Checking care_recipient table...');
            const [recipients] = await pool.execute(
                'SELECT care_recipient_id as id, name, email, contact_no as phone, password_hash, "care_recipient" as role FROM care_recipient WHERE email = ?',
                [email]
            );
            console.log('📊 Care recipients found:', recipients.length);
            
            if (recipients.length > 0) {
                user = recipients[0];
                userTable = 'care_recipient';
                console.log('✅ Found in care_recipient table');
                console.log('   Name:', user.name);
                console.log('   ID:', user.id);
                
                // Debug the hash
                console.log('   Stored hash prefix:', user.password_hash.substring(0, 30) + '...');
                console.log('   Expected hash prefix:', '$2a$10$N9qo8uLOickgx2ZMRZoMy.M...');
            }
        }

        if (!user) {
            console.log('❌ User NOT found in any table');
            console.log('=================================');
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Verify password
        console.log('🔐 Verifying password...');
        console.log('   Stored hash length:', user.password_hash.length);
        
        const isMatch = await bcrypt.compare(password, user.password_hash);
        console.log('   Password match result:', isMatch);
        
        if (!isMatch) {
            console.log('❌ Password does NOT match');
            console.log('=================================');
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        console.log('✅ Password match successful!');

        // Generate token
        console.log('🎫 Generating JWT token...');
        const token = jwt.sign(
            { id: user.id, role: user.role, table: userTable },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE || '7d' }
        );
        console.log('✅ Token generated successfully');

        console.log('🎉 LOGIN SUCCESSFUL for:', user.name);
        console.log('   Role:', user.role);
        console.log('   Table:', userTable);
        console.log('=================================');

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role
            }
        });
    } catch (error) {
        console.error('❌ Login error:', error);
        console.error('   Error message:', error.message);
        console.error('   Error stack:', error.stack);
        console.log('=================================');
        next(error);
    }
});

/**
 * @route   GET /api/auth/verify
 * @desc    Verify token validity
 * @access  Private
 */
router.get('/verify', require('../middleware/auth'), async (req, res) => {
    console.log('🔍 Token verification for user:', req.user.id);
    res.json({
        success: true,
        message: 'Token is valid',
        user: req.user
    });
});

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user (client clears token)
 * @access  Private
 */
router.post('/logout', require('../middleware/auth'), async (req, res) => {
    console.log('🚪 Logout request for user:', req.user.id);
    
    res.json({
        success: true,
        message: 'Logout successful - please clear client token'
    });
});

module.exports = router;