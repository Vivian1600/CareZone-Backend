const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const notificationService = require('../services/notificationService');

/**
 * @route   GET /api/notifications
 * @desc    Get user's notifications
 * @access  Private
 */
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const { limit = 50, offset = 0, unread_only = false } = req.query;
        const userType = req.user.role;
        const userId = req.user.id;
        
        // Convert to numbers
        const numLimit = parseInt(limit);
        const numOffset = parseInt(offset);
        
        let notifications;
        let count;
        
        if (unread_only === 'true') {
            notifications = await notificationService.getUnreadNotifications(userId, userType);
            count = notifications.length;
        } else {
            notifications = await notificationService.getUserNotifications(userId, userType, numLimit, numOffset);
            const [total] = await pool.execute(
                'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND user_type = ?',
                [userId, userType]
            );
            count = total[0].count;
        }
        
        res.json({
            success: true,
            data: notifications,
            count: count,
            unread_count: await notificationService.getUnreadCount(userId, userType)
        });
        
    } catch (error) {
        console.error('Error fetching notifications:', error);
        next(error);
    }
});

/**
 * @route   GET /api/notifications/unread-count
 * @desc    Get unread notification count
 * @access  Private
 */
router.get('/unread-count', authMiddleware, async (req, res, next) => {
    try {
        const userType = req.user.role;
        const userId = req.user.id;
        
        const count = await notificationService.getUnreadCount(userId, userType);
        
        res.json({
            success: true,
            count: count
        });
        
    } catch (error) {
        console.error('Error getting unread count:', error);
        next(error);
    }
});

/**
 * @route   PUT /api/notifications/:id/read
 * @desc    Mark a notification as read
 * @access  Private
 */
router.put('/:id/read', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        
        const success = await notificationService.markAsRead(id, userId);
        
        if (success) {
            res.json({
                success: true,
                message: 'Notification marked as read'
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }
        
    } catch (error) {
        console.error('Error marking notification as read:', error);
        next(error);
    }
});

/**
 * @route   PUT /api/notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private
 */
router.put('/read-all', authMiddleware, async (req, res, next) => {
    try {
        const userType = req.user.role;
        const userId = req.user.id;
        
        const count = await notificationService.markAllAsRead(userId, userType);
        
        res.json({
            success: true,
            message: `${count} notifications marked as read`,
            count: count
        });
        
    } catch (error) {
        console.error('Error marking all as read:', error);
        next(error);
    }
});

/**
 * @route   DELETE /api/notifications/:id
 * @desc    Delete a notification
 * @access  Private
 */
router.delete('/:id', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        
        const [result] = await pool.execute(
            'DELETE FROM notifications WHERE notification_id = ? AND user_id = ?',
            [id, userId]
        );
        
        if (result.affectedRows > 0) {
            res.json({
                success: true,
                message: 'Notification deleted'
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }
        
    } catch (error) {
        console.error('Error deleting notification:', error);
        next(error);
    }
});

module.exports = router;