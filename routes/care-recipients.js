// routes/care-recipients.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { isFamilyMember, isCaregiver } = require('../middleware/role');
const { validateRegisterCareRecipient, handleValidationErrors } = require('../middleware/validate');

/**
 * @route   POST /api/care-recipients/register
 * @desc    Family member registers a new care recipient
 * @access  Private (Family members only)
 */
router.post('/register', 
    authMiddleware, 
    isFamilyMember, 
    validateRegisterCareRecipient, 
    handleValidationErrors, 
    async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const familyMemberId = req.user.id;
            const {
                name, email, phone, date_of_birth, gender, relationship,
                care_level, emergency_contact_name, emergency_contact_phone,
                emergency_contact_relationship, medical_notes, address
            } = req.body;

            // Default password (should be changed on first login)
            const defaultPassword = 'password123';
            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(defaultPassword, salt);

            // Insert care recipient
            const [result] = await connection.execute(
                `INSERT INTO care_recipient 
                (name, email, contact_no, password_hash, date_of_birth, gender, 
                 care_level, medical_notes, address, emergency_contact_name, 
                 emergency_contact_phone, emergency_contact_relationship) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [name, email || null, phone || null, password_hash, date_of_birth, gender,
                 care_level || 'Medium', medical_notes, address,
                 emergency_contact_name, emergency_contact_phone, emergency_contact_relationship]
            );

            const careRecipientId = result.insertId;

            // Create family link
            await connection.execute(
                `INSERT INTO family_links (family_member_id, care_recipient_id, relationship, is_primary) 
                 VALUES (?, ?, ?, true)`,
                [familyMemberId, careRecipientId, relationship]
            );

            await connection.commit();

            res.status(201).json({
                success: true,
                message: 'Care recipient registered successfully',
                data: {
                    care_recipient_id: careRecipientId,
                    name,
                    relationship,
                    default_password: defaultPassword
                }
            });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    }
);

/**
 * @route   GET /api/care-recipients
 * @desc    Get all care recipients based on user role
 * @access  Private
 */
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        let query = '';
        let params = [];

        if (req.user.role === 'family_member') {
            query = `
                SELECT cr.*, fl.relationship,
                       cg.name as caregiver_name
                FROM care_recipient cr
                JOIN family_links fl ON cr.care_recipient_id = fl.care_recipient_id
                LEFT JOIN caregiver cg ON cr.assigned_caregiver_id = cg.caregiver_id
                WHERE fl.family_member_id = ?
                ORDER BY cr.name
            `;
            params = [req.user.id];
        } 
        else if (req.user.role === 'caregiver') {
            query = `
                SELECT cr.*, 
                       GROUP_CONCAT(DISTINCT CONCAT(fm.name, ' (', fl.relationship, ')') SEPARATOR ', ') as family_members
                FROM care_recipient cr
                LEFT JOIN family_links fl ON cr.care_recipient_id = fl.care_recipient_id
                LEFT JOIN family_member fm ON fl.family_member_id = fm.family_member_id
                WHERE cr.assigned_caregiver_id = ? OR cr.assigned_caregiver_id IS NULL
                GROUP BY cr.care_recipient_id
                ORDER BY cr.name
            `;
            params = [req.user.id];
        }
        else if (req.user.role === 'care_recipient') {
            query = `
                SELECT cr.*, cg.name as caregiver_name
                FROM care_recipient cr
                LEFT JOIN caregiver cg ON cr.assigned_caregiver_id = cg.caregiver_id
                WHERE cr.care_recipient_id = ?
            `;
            params = [req.user.id];
        }

        const [rows] = await pool.execute(query, params);
        
        res.json({
            success: true,
            count: rows.length,
            data: rows
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   GET /api/care-recipients/:id
 * @desc    Get single care recipient by ID
 * @access  Private
 */
router.get('/:id', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;

        const [rows] = await pool.execute(
            `SELECT cr.*, 
                    cg.name as caregiver_name,
                    cg.phone_no as caregiver_phone
             FROM care_recipient cr
             LEFT JOIN caregiver cg ON cr.assigned_caregiver_id = cg.caregiver_id
             WHERE cr.care_recipient_id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Care recipient not found'
            });
        }

        const recipient = rows[0];

        // Get family members
        const [family] = await pool.execute(
            `SELECT fm.family_member_id as id, fm.name, fm.contact_no as phone, 
                    fm.email, fl.relationship, fl.is_primary
             FROM family_links fl
             JOIN family_member fm ON fl.family_member_id = fm.family_member_id
             WHERE fl.care_recipient_id = ?`,
            [id]
        );

        // Get medications
        const [medications] = await pool.execute(
            `SELECT * FROM medication 
             WHERE care_recipient_id = ? AND is_active = true`,
            [id]
        );

        // Get recent visits
        const [visits] = await pool.execute(
            `SELECT v.*, cg.name as caregiver_name
             FROM visit v
             JOIN caregiver cg ON v.caregiver_id = cg.caregiver_id
             WHERE v.care_recipient_id = ?
             ORDER BY v.scheduled_time DESC
             LIMIT 5`,
            [id]
        );

        res.json({
            success: true,
            data: {
                ...recipient,
                family_members: family,
                medications,
                recent_visits: visits
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   PUT /api/care-recipients/:id/assign-caregiver
 * @desc    Assign caregiver to care recipient
 * @access  Private (Family members only)
 */
router.put('/:id/assign-caregiver',
    authMiddleware,
    isFamilyMember,
    async (req, res, next) => {
        try {
            const { id } = req.params;
            const { caregiver_id } = req.body;

            // Verify this family member is linked to this recipient
            const [link] = await pool.execute(
                'SELECT * FROM family_links WHERE family_member_id = ? AND care_recipient_id = ?',
                [req.user.id, id]
            );

            if (link.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'You are not linked to this care recipient'
                });
            }

            // Verify caregiver exists
            const [caregiver] = await pool.execute(
                'SELECT caregiver_id FROM caregiver WHERE caregiver_id = ?',
                [caregiver_id]
            );

            if (caregiver.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Caregiver not found'
                });
            }

            await pool.execute(
                'UPDATE care_recipient SET assigned_caregiver_id = ? WHERE care_recipient_id = ?',
                [caregiver_id, id]
            );

            res.json({
                success: true,
                message: 'Caregiver assigned successfully'
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @route   GET /api/care-recipients/:id/dashboard
 * @desc    Get comprehensive care recipient dashboard for caregiver
 * @access  Private (Caregiver only)
 */
router.get('/:id/dashboard', authMiddleware, isCaregiver, async (req, res, next) => {
    try {
        const { id } = req.params;

        console.log('=================================');
        console.log('📊 Fetching Care Recipient Dashboard');
        console.log('Care Recipient ID:', id);
        console.log('=================================');

        // Get care recipient details
        const [careRecipient] = await pool.execute(
            `SELECT care_recipient_id, name, email, contact_no, date_of_birth, gender, 
                    address, medical_notes, status, created_at
             FROM care_recipient 
             WHERE care_recipient_id = ?`,
            [id]
        );

        if (careRecipient.length === 0) {
            console.log('❌ Care recipient not found');
            return res.status(404).json({
                success: false,
                message: 'Care recipient not found'
            });
        }

        const recipient = careRecipient[0];
        console.log('✅ Care recipient found:', recipient.name);

        // Get family members
        console.log('👨‍👩‍👧 Fetching family members...');
        const [familyMembers] = await pool.execute(
            `SELECT fm.family_member_id as id, fm.name, fm.contact_no as phone, 
                    fm.email, fl.relationship, fl.is_primary
             FROM family_links fl
             JOIN family_member fm ON fl.family_member_id = fm.family_member_id
             WHERE fl.care_recipient_id = ?
             ORDER BY fl.is_primary DESC`,
            [id]
        );
        console.log('✅ Found', familyMembers.length, 'family members');

        // Get medications
        console.log('💊 Fetching medications...');
        const [medications] = await pool.execute(
            `SELECT medication_id, name, dosage, frequency, medical_condition, 
                    start_date, end_date, is_active
             FROM medication 
             WHERE care_recipient_id = ? AND is_active = 1
             ORDER BY created_at DESC`,
            [id]
        );
        console.log('✅ Found', medications.length, 'active medications');

        // Get medical conditions
        console.log('⚕️ Fetching medical conditions...');
        const [medicalConditions] = await pool.execute(
            `SELECT condition_id, condition_name, description, created_at
             FROM medical_conditions 
             WHERE care_recipient_id = ?
             ORDER BY created_at DESC`,
            [id]
        );
        console.log('✅ Found', medicalConditions.length, 'medical conditions');

        // Get scheduled visits
        console.log('📅 Fetching scheduled visits...');
        const [visits] = await pool.execute(
            `SELECT v.visit_id, v.scheduled_time, v.actual_start_time, v.actual_end_time,
                    v.notes, v.status,
                    cg.name as caregiver_name, cg.phone_no as caregiver_phone
             FROM visit v
             LEFT JOIN caregiver cg ON v.caregiver_id = cg.caregiver_id
             WHERE v.care_recipient_id = ? 
             AND v.scheduled_time >= NOW()
             ORDER BY v.scheduled_time ASC`,
            [id]
        );
        console.log('✅ Found', visits.length, 'scheduled visits');

        // Get tasks
        console.log('📋 Fetching tasks...');
        const [tasks] = await pool.execute(
            `SELECT t.task_id, t.description, t.status, t.scheduled_time, 
                    t.completed_at, t.notes,
                    cg.name as assigned_caregiver_name
             FROM task t
             JOIN visit v ON t.visit_id = v.visit_id
             LEFT JOIN caregiver cg ON t.caregiver_id = cg.caregiver_id
             WHERE v.care_recipient_id = ? 
             AND t.status IN ('pending', 'in_progress')
             ORDER BY t.scheduled_time ASC`,
            [id]
        );
        console.log('✅ Found', tasks.length, 'active tasks');

        console.log('✅ Dashboard data retrieved successfully');
        console.log('=================================');

        res.json({
            success: true,
            data: {
                care_recipient: recipient,
                family_members: familyMembers,
                medications: medications,
                medical_conditions: medicalConditions,
                scheduled_visits: visits,
                tasks: tasks,
                summary: {
                    total_family_members: familyMembers.length,
                    active_medications: medications.length,
                    medical_conditions_count: medicalConditions.length,
                    upcoming_visits: visits.length,
                    pending_tasks: tasks.length
                }
            }
        });
    } catch (error) {
        console.error('❌ Error fetching dashboard:', error);
        next(error);
    }
});

module.exports = router;