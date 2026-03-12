// routes/tasks.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { isCaregiver } = require('../middleware/role');
const { validateTask, handleValidationErrors } = require('../middleware/validate');

/**
 * @route   POST /api/tasks
 * @desc    Add a task to a visit
 * @access  Private (Caregivers only)
 */
router.post('/', authMiddleware, isCaregiver, validateTask, handleValidationErrors, async (req, res, next) => {
    try {
        const { visit_id, description, category, scheduled_time } = req.body;

        // Verify visit belongs to this caregiver
        const [visit] = await pool.execute(
            'SELECT visit_id FROM visit WHERE visit_id = ? AND caregiver_id = ?',
            [visit_id, req.user.id]
        );

        if (visit.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Visit not found or not assigned to you'
            });
        }

        const [result] = await pool.execute(
            `INSERT INTO task (visit_id, description, category, scheduled_time) 
             VALUES (?, ?, ?, ?)`,
            [visit_id, description, category, scheduled_time]
        );

        res.status(201).json({
            success: true,
            message: 'Task added successfully',
            task_id: result.insertId
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   GET /api/tasks/visit/:visit_id
 * @desc    Get all tasks for a specific visit
 * @access  Private
 */
router.get('/visit/:visit_id', authMiddleware, async (req, res, next) => {
    try {
        const { visit_id } = req.params;

        // Verify access to this visit
        let query = '';
        let params = [];

        if (req.user.role === 'caregiver') {
            query = `
                SELECT t.* FROM task t
                JOIN visit v ON t.visit_id = v.visit_id
                WHERE t.visit_id = ? AND v.caregiver_id = ?
            `;
            params = [visit_id, req.user.id];
        } else if (req.user.role === 'family_member') {
            query = `
                SELECT t.* FROM task t
                JOIN visit v ON t.visit_id = v.visit_id
                JOIN care_recipient cr ON v.care_recipient_id = cr.care_recipient_id
                JOIN family_links fl ON cr.care_recipient_id = fl.care_recipient_id
                WHERE t.visit_id = ? AND fl.family_member_id = ?
            `;
            params = [visit_id, req.user.id];
        } else if (req.user.role === 'care_recipient') {
            query = `
                SELECT t.* FROM task t
                JOIN visit v ON t.visit_id = v.visit_id
                JOIN care_recipient cr ON v.care_recipient_id = cr.care_recipient_id
                WHERE t.visit_id = ? AND cr.user_id = ?
            `;
            params = [visit_id, req.user.id];
        }

        const [tasks] = await pool.execute(query, params);

        res.json({
            success: true,
            count: tasks.length,
            data: tasks
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   PUT /api/tasks/:id
 * @desc    Update a task
 * @access  Private (Caregivers only)
 */
router.put('/:id', authMiddleware, isCaregiver, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { description, category, scheduled_time } = req.body;

        // Verify task belongs to caregiver's visit
        const [task] = await pool.execute(
            `SELECT t.task_id FROM task t
             JOIN visit v ON t.visit_id = v.visit_id
             WHERE t.task_id = ? AND v.caregiver_id = ?`,
            [id, req.user.id]
        );

        if (task.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Task not found or not assigned to you'
            });
        }

        await pool.execute(
            `UPDATE task 
             SET description = COALESCE(?, description),
                 category = COALESCE(?, category),
                 scheduled_time = COALESCE(?, scheduled_time)
             WHERE task_id = ?`,
            [description, category, scheduled_time, id]
        );

        res.json({
            success: true,
            message: 'Task updated successfully'
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   PUT /api/tasks/:id/complete
 * @desc    Mark task as complete
 * @access  Private (Caregivers only)
 */
router.put('/:id/complete', authMiddleware, isCaregiver, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        // Verify task belongs to caregiver's visit
        const [task] = await pool.execute(
            `SELECT t.task_id FROM task t
             JOIN visit v ON t.visit_id = v.visit_id
             WHERE t.task_id = ? AND v.caregiver_id = ?`,
            [id, req.user.id]
        );

        if (task.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Task not found or not assigned to you'
            });
        }

        await pool.execute(
            `UPDATE task 
             SET status = 'completed', 
                 completed_at = NOW(),
                 notes = CONCAT(IFNULL(notes, ''), ' ', COALESCE(?, ''))
             WHERE task_id = ?`,
            [notes || '', id]
        );

        res.json({
            success: true,
            message: 'Task marked as complete'
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   DELETE /api/tasks/:id
 * @desc    Delete a task
 * @access  Private (Caregivers only)
 */
router.delete('/:id', authMiddleware, isCaregiver, async (req, res, next) => {
    try {
        const { id } = req.params;

        // Verify task belongs to caregiver's visit
        const [result] = await pool.execute(
            `DELETE t FROM task t
             JOIN visit v ON t.visit_id = v.visit_id
             WHERE t.task_id = ? AND v.caregiver_id = ?`,
            [id, req.user.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Task not found or not assigned to you'
            });
        }

        res.json({
            success: true,
            message: 'Task deleted successfully'
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;