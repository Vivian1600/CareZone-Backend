// routes/alerts.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const authMiddleware = require('../middleware/auth');

/**
 * @route   GET /api/alerts
 * @desc    Get all alerts for current user
 * @access  Private
 */
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const [alerts] = await pool.execute(
            `SELECT a.*, ar.read_at,
                    cr.user_id as care_recipient_user_id,
                    u_cr.name as care_recipient_name
             FROM alert_recipients ar
             JOIN alerts a ON ar.alert_id = a.id
             LEFT JOIN care_recipients cr ON a.care_recipient_id = cr.id
             LEFT JOIN users u_cr ON cr.user_id = u_cr.id
             WHERE ar.user_id = ?
             ORDER BY a.created_at DESC`,
            [req.user.id]
        );

        res.json({
            success: true,
            count: alerts.length,
            data: alerts
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   GET /api/alerts/unread
 * @desc    Get unread alerts count
 * @access  Private
 */
router.get('/unread', authMiddleware, async (req, res, next) => {
    try {
        const [result] = await pool.execute(
            `SELECT COUNT(*) as unread_count
             FROM alert_recipients
             WHERE user_id = ? AND read_at IS NULL`,
            [req.user.id]
        );

        res.json({
            success: true,
            unread_count: result[0].unread_count
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   PUT /api/alerts/:id/read
 * @desc    Mark alert as read
 * @access  Private
 */
router.put('/:id/read', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;

        const [result] = await pool.execute(
            'UPDATE alert_recipients SET read_at = NOW() WHERE alert_id = ? AND user_id = ?',
            [id, req.user.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Alert not found'
            });
        }

        res.json({
            success: true,
            message: 'Alert marked as read'
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   PUT /api/alerts/read-all
 * @desc    Mark all alerts as read
 * @access  Private
 */
router.put('/read-all', authMiddleware, async (req, res, next) => {
    try {
        await pool.execute(
            'UPDATE alert_recipients SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL',
            [req.user.id]
        );

        res.json({
            success: true,
            message: 'All alerts marked as read'
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   POST /api/alerts/test/:care_recipient_id
 * @desc    Create a test alert (for development)
 * @access  Private (Family members only)
 */
router.post('/test/:care_recipient_id', authMiddleware, async (req, res, next) => {
    try {
        const { care_recipient_id } = req.params;
        const { type, message } = req.body;

        // Get all family members for this recipient
        const [family] = await pool.execute(
            'SELECT family_member_id FROM family_links WHERE care_recipient_id = ?',
            [care_recipient_id]
        );

        // Create alert
        const [alertResult] = await pool.execute(
            `INSERT INTO alerts (type, message, care_recipient_id) 
             VALUES (?, ?, ?)`,
            [type || 'general', message || 'Test alert', care_recipient_id]
        );

        // Add recipients
        for (const f of family) {
            await pool.execute(
                'INSERT INTO alert_recipients (alert_id, user_id) VALUES (?, ?)',
                [alertResult.insertId, f.family_member_id]
            );
        }

        res.status(201).json({
            success: true,
            message: 'Test alert created',
            alert_id: alertResult.insertId
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;