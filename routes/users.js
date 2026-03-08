// routes/users.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { isFamilyMember } = require('../middleware/role');

/**
 * @route   GET /api/users/profile
 * @desc    Get current user's profile
 * @access  Private
 */
router.get('/profile', authMiddleware, async (req, res, next) => {
    try {
        console.log('📋 Fetching profile for user ID:', req.user.id, 'Role:', req.user.role);
        
        let user = null;
        
        if (req.user.role === 'caregiver') {
            const [rows] = await pool.execute(
                `SELECT caregiver_id as id, name, email, phone_no as phone, 
                        address, type, is_active
                 FROM caregiver 
                 WHERE caregiver_id = ?`,
                [req.user.id]
            );
            if (rows.length > 0) {
                user = rows[0];
                user.role = 'caregiver';
            }
        } 
        else if (req.user.role === 'family_member') {
            const [rows] = await pool.execute(
                `SELECT family_member_id as id, name, email, contact_no as phone, 
                        relationship, is_primary
                 FROM family_member 
                 WHERE family_member_id = ?`,
                [req.user.id]
            );
            if (rows.length > 0) {
                user = rows[0];
                user.role = 'family_member';
            }
        }
        else if (req.user.role === 'care_recipient') {
            const [rows] = await pool.execute(
                `SELECT care_recipient_id as id, name, email, contact_no as phone,
                        date_of_birth, gender, address, medical_notes, status
                 FROM care_recipient 
                 WHERE care_recipient_id = ?`,
                [req.user.id]
            );
            if (rows.length > 0) {
                user = rows[0];
                user.role = 'care_recipient';
            }
        }

        if (!user) {
            console.log('❌ User not found for ID:', req.user.id);
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        console.log('✅ Profile retrieved for:', user.name);
        res.json({
            success: true,
            data: user
        });
    } catch (error) {
        console.error('❌ Profile error:', error);
        next(error);
    }
});

/**
 * @route   PUT /api/users/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put('/profile', authMiddleware, async (req, res, next) => {
    try {
        const { name, phone, address, type } = req.body;
        
        console.log('📝 Updating profile for user:', req.user.id, 'Role:', req.user.role);
        
        if (req.user.role === 'caregiver') {
            await pool.execute(
                `UPDATE caregiver 
                 SET name = COALESCE(?, name),
                     phone_no = COALESCE(?, phone_no),
                     address = COALESCE(?, address),
                     type = COALESCE(?, type)
                 WHERE caregiver_id = ?`,
                [name, phone, address, type, req.user.id]
            );
        } 
        else if (req.user.role === 'family_member') {
            await pool.execute(
                `UPDATE family_member 
                 SET name = COALESCE(?, name),
                     contact_no = COALESCE(?, contact_no)
                 WHERE family_member_id = ?`,
                [name, phone, req.user.id]
            );
        }
        else if (req.user.role === 'care_recipient') {
            await pool.execute(
                `UPDATE care_recipient 
                 SET name = COALESCE(?, name),
                     contact_no = COALESCE(?, contact_no),
                     address = COALESCE(?, address)
                 WHERE care_recipient_id = ?`,
                [name, phone, address, req.user.id]
            );
        }

        console.log('✅ Profile updated successfully');
        res.json({
            success: true,
            message: 'Profile updated successfully'
        });
    } catch (error) {
        console.error('❌ Profile update error:', error);
        next(error);
    }
});

/**
 * @route   PUT /api/users/change-password
 * @desc    Change user password
 * @access  Private
 */
router.put('/change-password', authMiddleware, async (req, res, next) => {
    try {
        const { current_password, new_password } = req.body;
        
        console.log('🔐 Password change requested for user:', req.user.id, 'Role:', req.user.role);
        
        let table = '';
        let idField = '';
        
        if (req.user.role === 'caregiver') {
            table = 'caregiver';
            idField = 'caregiver_id';
        } else if (req.user.role === 'family_member') {
            table = 'family_member';
            idField = 'family_member_id';
        } else if (req.user.role === 'care_recipient') {
            table = 'care_recipient';
            idField = 'care_recipient_id';
        }

        // Get current password hash
        const [users] = await pool.execute(
            `SELECT password_hash FROM ${table} WHERE ${idField} = ?`,
            [req.user.id]
        );

        if (users.length === 0) {
            console.log('❌ User not found for password change');
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(current_password, users[0].password_hash);
        if (!isMatch) {
            console.log('❌ Current password incorrect');
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const new_password_hash = await bcrypt.hash(new_password, salt);

        // Update password
        await pool.execute(
            `UPDATE ${table} SET password_hash = ? WHERE ${idField} = ?`,
            [new_password_hash, req.user.id]
        );

        console.log('✅ Password changed successfully for user:', req.user.id);
        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error) {
        console.error('❌ Password change error:', error);
        next(error);
    }
});

/**
 * @route   GET /api/users/caregivers
 * @desc    Get all available caregivers
 * @access  Private (Family members only)
 */
router.get('/caregivers', authMiddleware, isFamilyMember, async (req, res, next) => {
    try {
        console.log('📋 Caregivers list requested by family member:', req.user.id);
        
        const [caregivers] = await pool.execute(
            `SELECT caregiver_id as id, name, phone_no as phone, address, type
             FROM caregiver 
             WHERE is_active = true
             ORDER BY name`
        );

        console.log('✅ Found', caregivers.length, 'caregivers');
        res.json({
            success: true,
            count: caregivers.length,
            data: caregivers
        });
    } catch (error) {
        console.error('❌ Caregivers error:', error);
        next(error);
    }
});

/**
 * @route   GET /api/users/family-members/:care_recipient_id
 * @desc    Get all family members for a specific care recipient
 * @access  Private
 */
router.get('/family-members/:care_recipient_id', authMiddleware, async (req, res, next) => {
    try {
        const { care_recipient_id } = req.params;
        
        console.log('📋 Fetching family members for care recipient:', care_recipient_id);
        
        const [family] = await pool.execute(
            `SELECT fm.family_member_id as id, fm.name, fm.contact_no as phone, 
                    fm.email, fl.relationship, fl.is_primary
             FROM family_links fl
             JOIN family_member fm ON fl.family_member_id = fm.family_member_id
             WHERE fl.care_recipient_id = ?
             ORDER BY fl.is_primary DESC, fm.name ASC`,
            [care_recipient_id]
        );

        console.log('✅ Found', family.length, 'family members');
        res.json({
            success: true,
            count: family.length,
            data: family
        });
    } catch (error) {
        console.error('❌ Family members error:', error);
        next(error);
    }
});

module.exports = router;