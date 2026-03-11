// routes/visits.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { isCaregiver, isFamilyMember, isCaregiverOrFamily } = require('../middleware/role');
const { validateVisit, validateStartVisit, validateCompleteVisit, handleValidationErrors } = require('../middleware/validate');

/**
 * @route   POST /api/visits
 * @desc    Create a new visit
 * @access  Private (Family members or caregivers)
 */
router.post('/', authMiddleware, isCaregiverOrFamily, validateVisit, handleValidationErrors, async (req, res, next) => {
    try {
        const { care_recipient_id, scheduled_date, scheduled_time, notes } = req.body;

        // Combine date and time into scheduled_time DATETIME
        const scheduledDateTime = `${scheduled_date} ${scheduled_time || '00:00:00'}`;

        const [result] = await pool.execute(
            `INSERT INTO visit
            (caregiver_id, care_recipient_id, scheduled_time, notes, status)
            VALUES (?, ?, ?, ?, 'scheduled')`,
            [req.user.id, care_recipient_id, scheduledDateTime, notes]
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

/**
 * @route   GET /api/visits/my-visits
 * @desc    Get visits for current caregiver
 * @access  Private (Caregivers only)
 */
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

/**
 * @route   GET /api/visits/upcoming
 * @desc    Get upcoming visits for family member's recipients
 * @access  Private (Family members only)
 */
router.get('/upcoming', authMiddleware, isFamilyMember, async (req, res, next) => {
    try {
        const [rows] = await pool.execute(
            `SELECT v.*, cr.name as care_recipient_name, cg.name as caregiver_name
             FROM visit v
             JOIN care_recipient cr ON v.care_recipient_id = cr.care_recipient_id
             JOIN caregiver cg ON v.caregiver_id = cg.caregiver_id
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

/**
 * @route   GET /api/visits/:id
 * @desc    Get single visit by ID
 * @access  Private
 */
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
             JOIN caregiver cg ON v.caregiver_id = cg.caregiver_id
             WHERE v.visit_id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Visit not found'
            });
        }

        // Get tasks for this visit if tasks table exists
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

/**
 * @route   POST /api/visits/:id/start
 * @desc    Start a visit (check-in)
 * @access  Private (Caregivers only)
 */
router.post('/:id/start', authMiddleware, isCaregiver, validateStartVisit, handleValidationErrors, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { latitude, longitude } = req.body;

        // Verify this visit belongs to the caregiver
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
                 actual_start_time = NOW(),
                 check_in_lat = ?,
                 check_in_lng = ?
             WHERE visit_id = ?`,
            [latitude, longitude, id]
        );

        res.json({
            success: true,
            message: 'Visit started successfully'
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   POST /api/visits/:id/complete
 * @desc    Complete a visit with tasks
 * @access  Private (Caregivers only)
 */
router.post('/:id/complete', authMiddleware, isCaregiver, validateCompleteVisit, handleValidationErrors, async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;
        const { latitude, longitude, tasks, notes } = req.body;

        // Update visit
        await connection.execute(
            `UPDATE visit
             SET status = 'completed',
                 actual_end_time = NOW(),
                 check_out_lat = ?,
                 check_out_lng = ?,
                 notes = CONCAT(IFNULL(notes, ''), ' ', ?)
             WHERE visit_id = ? AND caregiver_id = ?`,
            [latitude, longitude, notes || '', id, req.user.id]
        );

        // Update tasks if provided
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