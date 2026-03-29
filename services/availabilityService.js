const { pool } = require('../config/database');

class AvailabilityService {
    
    /**
     * Get the start (Monday) and end (Friday) of current week
     * @param {Date} date - Reference date (defaults to today)
     * @returns {Object} { weekStart, weekEnd }
     */
    getWeekRange(date = new Date()) {
        const currentDate = new Date(date);
        const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 1 = Monday
        
        // Calculate Monday (day 1)
        const weekStart = new Date(currentDate);
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        weekStart.setDate(currentDate.getDate() - daysToMonday);
        weekStart.setHours(0, 0, 0, 0);
        
        // Calculate Friday (day 5)
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 4); // Monday + 4 = Friday
        weekEnd.setHours(23, 59, 59, 999);
        
        return {
            weekStart: weekStart.toISOString().split('T')[0],
            weekEnd: weekEnd.toISOString().split('T')[0]
        };
    }

    /**
     * Count visits for a caregiver in a given week (Monday-Friday only)
     * @param {number} caregiverId 
     * @param {string} weekStart - YYYY-MM-DD
     * @param {string} weekEnd - YYYY-MM-DD
     * @returns {Promise<number>} Visit count
     */
    async countWeeklyVisits(caregiverId, weekStart, weekEnd) {
        try {
            const [result] = await pool.execute(
                `SELECT COUNT(*) as count
                 FROM visit
                 WHERE caregiver_id = ?
                   AND DATE(scheduled_time) BETWEEN ? AND ?
                   AND status NOT IN ('cancelled', 'declined')
                   AND DAYOFWEEK(scheduled_time) BETWEEN 2 AND 6`, // Monday(2) to Friday(6)
                [caregiverId, weekStart, weekEnd]
            );
            return result[0].count;
        } catch (error) {
            console.error('Error counting weekly visits:', error);
            throw error;
        }
    }

    /**
     * Check if caregiver already has a visit on a specific day
     * @param {number} caregiverId 
     * @param {string} date - YYYY-MM-DD
     * @returns {Promise<boolean>} True if already booked
     */
    async isCaregiverBookedOnDay(caregiverId, date) {
        try {
            const [result] = await pool.execute(
                `SELECT COUNT(*) as count
                 FROM visit
                 WHERE caregiver_id = ?
                   AND DATE(scheduled_time) = ?
                   AND status NOT IN ('cancelled', 'declined')`,
                [caregiverId, date]
            );
            return result[0].count > 0;
        } catch (error) {
            console.error('Error checking daily booking:', error);
            throw error;
        }
    }

    /**
     * Get all active caregivers with their weekly visit count
     * @param {string} weekStart 
     * @param {string} weekEnd 
     * @returns {Promise<Array>} List of caregivers with visit counts
     */
    async getAllCaregiversWithWeeklyCounts(weekStart, weekEnd) {
        try {
            const [caregivers] = await pool.execute(
                `SELECT c.caregiver_id, c.name, c.phone_no
                 FROM caregiver c
                 WHERE c.is_active = 1`
            );
            
            // Get counts for each caregiver
            const caregiversWithCounts = await Promise.all(
                caregivers.map(async (caregiver) => {
                    const weeklyCount = await this.countWeeklyVisits(
                        caregiver.caregiver_id, 
                        weekStart, 
                        weekEnd
                    );
                    return {
                        ...caregiver,
                        weekly_visits: weeklyCount
                    };
                })
            );
            
            return caregiversWithCounts;
        } catch (error) {
            console.error('Error getting caregivers:', error);
            throw error;
        }
    }

    /**
     * Find available caregivers for a specific date
     * @param {string} date - YYYY-MM-DD
     * @returns {Promise<Array>} List of available caregivers
     */
    async findAvailableCaregiversForDate(date) {
        try {
            const weekRange = this.getWeekRange(new Date(date));
            
            // Get all caregivers with their weekly counts
            const allCaregivers = await this.getAllCaregiversWithWeeklyCounts(
                weekRange.weekStart, 
                weekRange.weekEnd
            );
            
            // Filter caregivers
            const availableCaregivers = [];
            
            for (const caregiver of allCaregivers) {
                // Check if at max weekly visits (5)
                if (caregiver.weekly_visits >= 5) {
                    continue;
                }
                
                // Check if already booked on this day
                const isBooked = await this.isCaregiverBookedOnDay(
                    caregiver.caregiver_id, 
                    date
                );
                
                if (!isBooked) {
                    availableCaregivers.push(caregiver);
                }
            }
            
            return availableCaregivers;
        } catch (error) {
            console.error('Error finding available caregivers:', error);
            throw error;
        }
    }

    /**
     * Find the best available caregiver (fair assignment)
     * @param {string} date - YYYY-MM-DD
     * @returns {Promise<Object|null>} Best caregiver or null if none available
     */
    async findBestAvailableCaregiver(date) {
        try {
            const weekRange = this.getWeekRange(new Date(date));
            const availableCaregivers = await this.findAvailableCaregiversForDate(date);
            
            if (availableCaregivers.length === 0) {
                return null;
            }
            
            // Sort by weekly visits (ascending) - fair assignment
            availableCaregivers.sort((a, b) => a.weekly_visits - b.weekly_visits);
            
            // Return the caregiver with fewest visits this week
            return availableCaregivers[0];
        } catch (error) {
            console.error('Error finding best caregiver:', error);
            throw error;
        }
    }

    /**
     * Check if any caregiver is available on a given date
     * @param {string} date - YYYY-MM-DD
     * @returns {Promise<boolean>}
     */
    async isDateAvailable(date) {
        const available = await this.findAvailableCaregiversForDate(date);
        return available.length > 0;
    }

    /**
     * Get availability summary for a week
     * @param {string} startDate - YYYY-MM-DD (Monday)
     * @returns {Promise<Object>} Availability for each day of the week
     */
    async getWeeklyAvailability(startDate) {
        const weekRange = this.getWeekRange(new Date(startDate));
        const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const availability = {};
        
        for (let i = 0; i < 5; i++) {
            const currentDate = new Date(weekRange.weekStart);
            currentDate.setDate(currentDate.getDate() + i);
            const dateStr = currentDate.toISOString().split('T')[0];
            const availableCaregivers = await this.findAvailableCaregiversForDate(dateStr);
            
            availability[weekDays[i]] = {
                date: dateStr,
                available: availableCaregivers.length > 0,
                caregiver_count: availableCaregivers.length
            };
        }
        
        return availability;
    }
}

module.exports = new AvailabilityService();