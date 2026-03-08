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

        const [result] = await pool.execute(
            `INSERT INTO visits 
            (caregiver_id, care_recipient_id, scheduled_date, scheduled_time, notes, status) 
            VALUES (?, ?, ?, ?, ?, 'scheduled')`,
            [req.user.id, care_recipient_id, scheduled_date, scheduled_time, notes]
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
            `SELECT v.*, u.name as care_recipient_name
             FROM visits v
             JOIN care_recipients cr ON v.care_recipient_id = cr.id
             JOIN users u ON cr.user_id = u.id
             WHERE v.caregiver_id = ?
             ORDER BY v.scheduled_date DESC`,
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
            'SELECT id FROM visits WHERE id = ? AND caregiver_id = ?',
            [id, req.user.id]
        );

        if (visit.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Visit not found or not assigned to you'
            });
        }

        await pool.execute(
            `UPDATE visits 
             SET status = 'in_progress', 
                 actual_start = NOW(),
                 check_in_lat = ?,
                 check_in_lng = ?
             WHERE id = ?`,
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
            `UPDATE visits 
             SET status = 'completed',
                 actual_end = NOW(),
                 check_out_lat = ?,
                 check_out_lng = ?,
                 notes = CONCAT(IFNULL(notes, ''), ' ', ?)
             WHERE id = ? AND caregiver_id = ?`,
            [latitude, longitude, notes || '', id, req.user.id]
        );

        // Update tasks if provided
        if (tasks && tasks.length > 0) {
            for (const task of tasks) {
                await connection.execute(
                    `UPDATE tasks 
                     SET completed = true,
                         completed_at = NOW()
                     WHERE id = ? AND visit_id = ?`,
                    [task.id, id]
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