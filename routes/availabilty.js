const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { isFamilyMember } = require('../middleware/role');
const availabilityService = require('../services/availabilityService');

/**
 * @route   GET /api/availability/week
 * @desc    Get weekly availability for scheduling
 * @access  Private (Family members only)
 */
router.get('/week', authMiddleware, isFamilyMember, async (req, res, next) => {
    try {
        const { start_date } = req.query;
        
        let weekStart;
        if (start_date) {
            weekStart = start_date;
        } else {
            // Default to current week's Monday
            const today = new Date();
            const dayOfWeek = today.getDay();
            const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            const monday = new Date(today);
            monday.setDate(today.getDate() - daysToMonday);
            weekStart = monday.toISOString().split('T')[0];
        }
        
        const availability = await availabilityService.getWeeklyAvailability(weekStart);
        
        res.json({
            success: true,
            data: availability
        });
        
    } catch (error) {
        console.error('Error fetching availability:', error);
        next(error);
    }
});

/**
 * @route   GET /api/availability/date/:date
 * @desc    Check availability for a specific date
 * @access  Private (Family members only)
 */
router.get('/date/:date', authMiddleware, isFamilyMember, async (req, res, next) => {
    try {
        const { date } = req.params;
        const isAvailable = await availabilityService.isDateAvailable(date);
        const availableCaregivers = await availabilityService.findAvailableCaregiversForDate(date);
        
        res.json({
            success: true,
            data: {
                date: date,
                available: isAvailable,
                caregiver_count: availableCaregivers.length
            }
        });
        
    } catch (error) {
        console.error('Error checking date availability:', error);
        next(error);
    }
});

module.exports = router;