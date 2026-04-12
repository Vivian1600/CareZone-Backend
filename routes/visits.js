const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { isCaregiver, isFamilyMember, isCaregiverOrFamily } = require('../middleware/role');
const { validateVisit, validateStartVisit, validateCompleteVisit, handleValidationErrors } = require('../middleware/validate');
const autoAssignCaregiver = require('../services/autoAssignCaregiver');
const availabilityService = require('../services/availabilityService');
const notificationService = require('../services/notificationService');

// =====================================================
// Helper function to generate default tasks
// =====================================================
async function generateDefaultTasks(connection, careRecipientId, caregiverId, visitId) {
    try {
        console.log('📋 Generating default tasks for visit:', visitId);
        
        const [conditions] = await connection.execute(
            `SELECT condition_name FROM medical_conditions 
             WHERE care_recipient_id = ?`,
            [careRecipientId]
        );

        const conditionNames = conditions.map(c => c.condition_name.toLowerCase());
        
        const defaultTasks = [
            { description: 'Check vital signs (BP, heart rate, temperature)' },
            { description: 'Medication adherence check' },
            { description: 'General wellness assessment' }
        ];

        if (conditionNames.some(c => c.includes('diabetes'))) {
            defaultTasks.push(
                { description: 'Check blood glucose levels' },
                { description: 'Administer insulin if prescribed' }
            );
        }

        if (conditionNames.some(c => c.includes('hypertension'))) {
            defaultTasks.push(
                { description: 'Monitor blood pressure' }
            );
        }

        if (conditionNames.some(c => c.includes('arthritis'))) {
            defaultTasks.push(
                { description: 'Assist with mobility exercises' }
            );
        }

        if (conditionNames.some(c => c.includes('stroke'))) {
            defaultTasks.push(
                { description: 'Physical therapy exercises' },
                { description: 'Fall risk assessment' }
            );
        }

        if (conditionNames.some(c => c.includes('atrial fibrillation'))) {
            defaultTasks.push(
                { description: 'Check pulse for irregular rhythm' }
            );
        }

        const uniqueTasks = defaultTasks.filter((task, index, self) =>
            index === self.findIndex(t => t.description === task.description)
        );

        const tasksToInsert = uniqueTasks.slice(0, 5);
        
        for (const task of tasksToInsert) {
            await connection.execute(
                `INSERT INTO task 
                 (visit_id, caregiver_id, description, scheduled_time, status) 
                 VALUES (?, ?, ?, '09:00:00', 'pending')`,
                [visitId, caregiverId, task.description]
            );
        }

        console.log(`✅ Generated ${tasksToInsert.length} tasks for visit ${visitId}`);
        return tasksToInsert;

    } catch (error) {
        console.error('❌ Error generating tasks:', error);
        throw error;
    }
}

// =====================================================
// POST /api/visits - Create a new visit
// =====================================================
router.post('/', authMiddleware, isCaregiverOrFamily, validateVisit, handleValidationErrors, async (req, res, next) => {
    try {
        const { care_recipient_id, scheduled_date, scheduled_time, notes } = req.body;

        const scheduledDateTime = `${scheduled_date} ${scheduled_time || '00:00:00'}`;
        const caregiverId = req.user.role === 'caregiver' ? req.user.id : null;

        const [result] = await pool.execute(
            `INSERT INTO visit
            (caregiver_id, care_recipient_id, scheduled_time, notes, status, acknowledged)
            VALUES (?, ?, ?, ?, 'scheduled', false)`,
            [caregiverId, care_recipient_id, scheduledDateTime, notes]
        );

        res.status(201).json({
            success: true,
            message: 'Visit created successfully',
            visit_id: result.insertId
        });
    } catch (error) {
        next(error);
    }
});

// =====================================================
// GET /api/visits/pending-acknowledgment - Get pending acknowledgments for caregiver
// ===================================================
router.get('/pending-acknowledgment', authMiddleware, isCaregiver, async (req, res, next) => {
    try {
        console.log('🔍 Fetching pending acknowledgments for caregiver:', req.user.id);
        
        const [visits] = await pool.execute(
            `SELECT v.*, cr.name as recipient_name, cr.address, cr.emergency_contact_name, cr.emergency_contact_phone
             FROM visit v
             JOIN care_recipient cr ON v.care_recipient_id = cr.care_recipient_id
             WHERE v.caregiver_id = ? 
               AND (v.acknowledged = false OR v.acknowledged IS NULL)
               AND (v.declined_by_caregiver = false OR v.declined_by_caregiver IS NULL)
               AND v.status = 'scheduled'
             ORDER BY v.scheduled_time ASC`,
            [req.user.id]
        );
        
        console.log('✅ Found', visits.length, 'pending acknowledgments');
        
        res.json({
            success: true,
            count: visits.length,
            data: visits
        });
        
    } catch (error) {
        console.error('❌ Error fetching pending acknowledgments:', error);
        next(error);
    }
});

// =====================================================
// POST /api/visits/:visitId/acknowledge - Acknowledge/accept a visit
// =====================================================
router.post('/:visitId/acknowledge', authMiddleware, isCaregiver, async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const { visitId } = req.params;
        const { notes } = req.body;
        
        console.log('✅ Acknowledging visit:', visitId, 'by caregiver:', req.user.id);
        
        // Verify visit belongs to this caregiver and is not already acknowledged
        const [visits] = await connection.execute(
            `SELECT * FROM visit WHERE visit_id = ? AND caregiver_id = ? AND (acknowledged = false OR acknowledged IS NULL)`,
            [visitId, req.user.id]
        );
        
        if (visits.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Visit not found, not assigned to you, or already acknowledged'
            });
        }
        
        // Get visit details for notification
        const [visitDetails] = await connection.execute(
            `SELECT v.*, cr.name as recipient_name, cg.name as caregiver_name
             FROM visit v
             JOIN care_recipient cr ON v.care_recipient_id = cr.care_recipient_id
             JOIN caregiver cg ON v.caregiver_id = cg.caregiver_id
             WHERE v.visit_id = ?`,
            [visitId]
        );
        
        // Update visit as acknowledged - KEEP status as 'scheduled'
        await connection.execute(
            `UPDATE visit 
             SET acknowledged = true, 
                 acknowledged_at = NOW(),
                 acknowledgment_notes = ?
             WHERE visit_id = ?`,
            [notes || null, visitId]
        );
        
        await connection.commit();
        
        console.log(`✅ Visit ${visitId} acknowledged successfully`);
        
        // Send notification to family members
        if (visitDetails.length > 0) {
            await notificationService.notifyVisitAcknowledged(
                visitId,
                visitDetails[0].care_recipient_id,
                visitDetails[0].caregiver_name,
                visitDetails[0].recipient_name,
                visitDetails[0].scheduled_time
            );
        }
        
        res.json({
            success: true,
            message: 'Visit confirmed successfully'
        });
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Error acknowledging visit:', error);
        next(error);
    } finally {
        connection.release();
    }
});

// =====================================================
// POST /api/visits/:visitId/decline - Decline a visit
// =====================================================
router.post('/:visitId/decline', authMiddleware, isCaregiver, async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const { visitId } = req.params;
        const { reason } = req.body;
        
        console.log('❌ Declining visit:', visitId, 'by caregiver:', req.user.id, 'Reason:', reason);
        
        // Verify visit belongs to this caregiver
        const [visits] = await connection.execute(
            `SELECT v.*, cr.name as recipient_name 
             FROM visit v
             JOIN care_recipient cr ON v.care_recipient_id = cr.care_recipient_id
             WHERE v.visit_id = ? AND v.caregiver_id = ? AND (v.acknowledged = false OR v.acknowledged IS NULL)`,
            [visitId, req.user.id]
        );
        
        if (visits.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Visit not found, not assigned to you, or already acknowledged'
            });
        }
        
        const visit = visits[0];
        
        // Mark as declined - KEEP status as 'scheduled' but mark declined flag
        await connection.execute(
            `UPDATE visit 
             SET declined_by_caregiver = true, 
                 declined_at = NOW(),
                 declined_reason = ?
             WHERE visit_id = ?`,
            [reason || 'No reason provided', visitId]
        );
        
        // Try to find another caregiver to reassign
        const scheduledDate = new Date(visit.scheduled_time).toISOString().split('T')[0];
        const scheduledTime = visit.scheduled_time.toTimeString().split(' ')[0].substring(0, 5);
        
        console.log('🤖 Attempting to reassign declined visit...');
        
        const newCaregiver = await autoAssignCaregiver(
            connection,
            visit.care_recipient_id,
            `${scheduledDate} ${scheduledTime}`
        );
        
        let reassigned = false;
        let newCaregiverInfo = null;
        
        if (newCaregiver) {
            // Create new visit with new caregiver
            const [newVisit] = await connection.execute(
                `INSERT INTO visit 
                 (caregiver_id, care_recipient_id, scheduled_time, notes, status, acknowledged)
                 VALUES (?, ?, ?, ?, 'scheduled', false)`,
                [newCaregiver.caregiver_id, visit.care_recipient_id, visit.scheduled_time, visit.notes]
            );
            
            reassigned = true;
            newCaregiverInfo = {
                id: newCaregiver.caregiver_id,
                name: newCaregiver.name,
                phone: newCaregiver.phone_no
            };
            
            console.log(`✅ Reassigned to new caregiver: ${newCaregiver.name} (Visit ID: ${newVisit.insertId})`);
        } else {
            console.log('⚠️ No caregiver available for reassignment');
        }
        
        await connection.commit();
        
        // Send notification to family members about declined visit
        await notificationService.notifyVisitDeclined(
            visitId,
            visit.care_recipient_id,
            visit.caregiver_name,
            visit.recipient_name,
            reason,
            visit.scheduled_time
        );
        
        res.json({
            success: true,
            message: reassigned ? 'Visit declined and reassigned to another caregiver' : 'Visit declined. No other caregivers available.',
            reassigned: reassigned,
            new_caregiver: newCaregiverInfo
        });
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Error declining visit:', error);
        next(error);
    } finally {
        connection.release();
    }
});

// =====================================================
// GET /api/visits/my-visits - Get visits for current caregiver
// =====================================================
router.get('/my-visits', authMiddleware, isCaregiver, async (req, res, next) => {
    try {
        const [rows] = await pool.execute(
            `SELECT v.*, cr.name as care_recipient_name
             FROM visit v
             JOIN care_recipient cr ON v.care_recipient_id = cr.care_recipient_id
             WHERE v.caregiver_id = ?
             ORDER BY v.scheduled_time DESC`,
            [req.user.id]
        );

        res.json({
            success: true,
            count: rows.length,
            data: rows
        });
    } catch (error) {
        next(error);
    }
});

// =====================================================
// GET /api/visits/upcoming - Get upcoming visits for family member's recipients
// =====================================================
router.get('/upcoming', authMiddleware, isFamilyMember, async (req, res, next) => {
    try {
        const [rows] = await pool.execute(
            `SELECT v.*, cr.name as care_recipient_name, cg.name as caregiver_name, v.acknowledged
             FROM visit v
             JOIN care_recipient cr ON v.care_recipient_id = cr.care_recipient_id
             LEFT JOIN caregiver cg ON v.caregiver_id = cg.caregiver_id
             JOIN family_links fl ON cr.care_recipient_id = fl.care_recipient_id
             WHERE fl.family_member_id = ? 
               AND v.scheduled_time >= NOW()
               AND v.status IN ('scheduled', 'in_progress')
             ORDER BY v.scheduled_time ASC`,
            [req.user.id]
        );

        res.json({
            success: true,
            count: rows.length,
            data: rows
        });
    } catch (error) {
        next(error);
    }
});

// =====================================================
// GET /api/visits - Get all visits for the logged-in user
// =====================================================
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        let query = '';
        let params = [];

        if (req.user.role === 'care_recipient') {
            query = `
                SELECT v.*, cg.name as caregiver_name
                FROM visit v
                LEFT JOIN caregiver cg ON v.caregiver_id = cg.caregiver_id
                WHERE v.care_recipient_id = ?
                ORDER BY v.scheduled_time DESC
            `;
            params = [req.user.id];
        } 
        else if (req.user.role === 'caregiver') {
            query = `
                SELECT v.*, cr.name as care_recipient_name
                FROM visit v
                JOIN care_recipient cr ON v.care_recipient_id = cr.care_recipient_id
                WHERE v.caregiver_id = ?
                ORDER BY v.scheduled_time DESC
            `;
            params = [req.user.id];
        }
        else if (req.user.role === 'family_member') {
            query = `
                SELECT v.*, cr.name as care_recipient_name, cg.name as caregiver_name
                FROM visit v
                JOIN care_recipient cr ON v.care_recipient_id = cr.care_recipient_id
                JOIN caregiver cg ON v.caregiver_id = cg.caregiver_id
                JOIN family_links fl ON cr.care_recipient_id = fl.care_recipient_id
                WHERE fl.family_member_id = ?
                ORDER BY v.scheduled_time DESC
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

// =====================================================
// POST /api/visits/schedule - Schedule a new visit (auto-assigns caregiver)
// =====================================================
router.post('/schedule', authMiddleware, isFamilyMember, async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { care_recipient_id, scheduled_date, scheduled_time, notes } = req.body;
        
        console.log('📅 Schedule request received:', {
            care_recipient_id,
            scheduled_date,
            scheduled_time,
            notes,
            family_member_id: req.user.id
        });

        if (!care_recipient_id || !scheduled_date || !scheduled_time) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: care_recipient_id, scheduled_date, scheduled_time'
            });
        }

        const scheduledDateTime = `${scheduled_date} ${scheduled_time}`;
        console.log('📅 Scheduled datetime:', scheduledDateTime);

        const [linkCheck] = await connection.execute(
            `SELECT * FROM family_links 
             WHERE family_member_id = ? AND care_recipient_id = ?`,
            [req.user.id, care_recipient_id]
        );

        console.log('🔗 Link check result:', linkCheck);

        if (linkCheck.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to schedule visits for this care recipient'
            });
        }

        console.log('🤖 Checking availability for date:', scheduled_date);
        
        const availableCount = await availabilityService.findAvailableCaregiversForDate(scheduled_date);
        
        if (availableCount.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No caregivers available on this date. Please choose another day.'
            });
        }
        
        console.log('✅ Found', availableCount.length, 'caregivers available');

        console.log('🤖 Attempting to auto-assign caregiver...');
        const assignedCaregiver = await autoAssignCaregiver(
            connection, 
            care_recipient_id, 
            scheduledDateTime
        );

        console.log('🤖 Assigned caregiver:', assignedCaregiver);

        if (!assignedCaregiver) {
            return res.status(400).json({
                success: false,
                message: 'No caregiver available at this time. Please choose another time.'
            });
        }

        const [visitResult] = await connection.execute(
            `INSERT INTO visit 
             (caregiver_id, care_recipient_id, scheduled_time, notes, status, acknowledged) 
             VALUES (?, ?, ?, ?, 'scheduled', false)`,
            [assignedCaregiver.caregiver_id, care_recipient_id, scheduledDateTime, notes || null]
        );

        const visitId = visitResult.insertId;
        console.log('✅ Visit created with ID:', visitId);

        // Get recipient name for notification
        const [recipient] = await connection.execute(
            'SELECT name FROM care_recipient WHERE care_recipient_id = ?',
            [care_recipient_id]
        );

        await generateDefaultTasks(connection, care_recipient_id, assignedCaregiver.caregiver_id, visitId);

        await connection.commit();

        // Send notification to caregiver
        await notificationService.notifyVisitScheduled(
            visitId,
            assignedCaregiver.caregiver_id,
            assignedCaregiver.name,
            recipient[0].name,
            scheduledDateTime
        );

        res.status(201).json({
            success: true,
            message: 'Visit scheduled successfully',
            visit_id: visitId,
            assigned_caregiver: {
                id: assignedCaregiver.caregiver_id,
                name: assignedCaregiver.name,
                phone: assignedCaregiver.phone_no
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Error scheduling visit:', error);
        res.status(500).json({
            success: false,
            message: 'Server error: ' + error.message
        });
    } finally {
        connection.release();
    }
});

// =====================================================
// GET /api/visits/:id - Get single visit by ID (MUST BE LAST)
// =====================================================
router.get('/:id', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;

        const [rows] = await pool.execute(
            `SELECT v.*, 
                    cr.name as care_recipient_name,
                    cg.name as caregiver_name,
                    cg.phone_no as caregiver_phone
             FROM visit v
             JOIN care_recipient cr ON v.care_recipient_id = cr.care_recipient_id
             LEFT JOIN caregiver cg ON v.caregiver_id = cg.caregiver_id
             WHERE v.visit_id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Visit not found'
            });
        }

        try {
            const [tasks] = await pool.execute(
                'SELECT * FROM task WHERE visit_id = ? ORDER BY scheduled_time',
                [id]
            );
            rows[0].tasks = tasks;
        } catch {
            rows[0].tasks = [];
        }

        res.json({
            success: true,
            data: rows[0]
        });
    } catch (error) {
        next(error);
    }
});

// =====================================================
// POST /api/visits/:id/start - Start a visit (check-in)
// =====================================================
router.post('/:id/start', authMiddleware, isCaregiver, validateStartVisit, handleValidationErrors, async (req, res, next) => {
    try {
        const { id } = req.params;

        const [visit] = await pool.execute(
            'SELECT visit_id FROM visit WHERE visit_id = ? AND caregiver_id = ?',
            [id, req.user.id]
        );

        if (visit.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Visit not found or not assigned to you'
            });
        }

        await pool.execute(
            `UPDATE visit
             SET status = 'in_progress',
                 actual_start_time = NOW()
             WHERE visit_id = ?`,
            [id]
        );

        res.json({
            success: true,
            message: 'Visit started successfully'
        });
    } catch (error) {
        next(error);
    }
});

// =====================================================
// POST /api/visits/:id/complete - Complete a visit with tasks
// =====================================================
router.post('/:id/complete', authMiddleware, isCaregiver, validateCompleteVisit, handleValidationErrors, async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;
        const { tasks, notes } = req.body;

        // Get visit details before update for notification
        const [visitDetails] = await connection.execute(
            `SELECT v.*, cr.name as recipient_name, cg.name as caregiver_name
             FROM visit v
             JOIN care_recipient cr ON v.care_recipient_id = cr.care_recipient_id
             JOIN caregiver cg ON v.caregiver_id = cg.caregiver_id
             WHERE v.visit_id = ?`,
            [id]
        );

        await connection.execute(
            `UPDATE visit
             SET status = 'completed',
                 actual_end_time = NOW(),
                 notes = CONCAT(IFNULL(notes, ''), ' ', COALESCE(?, ''))
             WHERE visit_id = ? AND caregiver_id = ?`,
            [notes || '', id, req.user.id]
        );

        if (tasks && tasks.length > 0) {
            for (const task of tasks) {
                await connection.execute(
                    `UPDATE task
                     SET status = 'completed',
                         completed_at = NOW(),
                         notes = CONCAT(IFNULL(notes, ''), ' ', COALESCE(?, ''))
                     WHERE task_id = ? AND visit_id = ?`,
                    [task.notes || '', task.id, id]
                );
            }
        }

        await connection.commit();

        // Send notification to family members
        if (visitDetails.length > 0) {
            await notificationService.notifyVisitCompleted(
                id,
                visitDetails[0].care_recipient_id,
                visitDetails[0].caregiver_name,
                visitDetails[0].recipient_name,
                new Date()
            );
        }

        res.json({
            success: true,
            message: 'Visit completed successfully'
        });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
});

module.exports = router;