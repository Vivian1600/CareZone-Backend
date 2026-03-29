// services/autoAssignCaregiver.js

/**
 * Auto-assign the best available caregiver for a visit
 * @param {Object} connection - MySQL connection
 * @param {number} careRecipientId - ID of the care recipient
 * @param {string} scheduledDateTime - Date and time of the visit
 * @returns {Object} - Selected caregiver object or null
 */
async function autoAssignCaregiver(connection, careRecipientId, scheduledDateTime) {
    try {
        console.log('🤖 Auto-assigning caregiver for recipient:', careRecipientId);
        console.log('📅 Scheduled time:', scheduledDateTime);

        // Get all active caregivers
        const [caregivers] = await connection.execute(
            `SELECT c.*,
                    COUNT(v.visit_id) as total_visits,
                    SUM(CASE WHEN DATE(v.scheduled_time) = CURDATE() THEN 1 ELSE 0 END) as today_visits
             FROM caregiver c
             LEFT JOIN visit v ON c.caregiver_id = v.caregiver_id
             WHERE c.is_active = 1
             GROUP BY c.caregiver_id
             ORDER BY today_visits ASC, total_visits ASC`,
            []
        );

        console.log('📊 Available caregivers:', caregivers.length);

        if (!caregivers.length) {
            console.log('❌ No active caregivers found');
            return null;
        }

        // Check availability for the scheduled time
        const availableCaregivers = [];
        
        for (const caregiver of caregivers) {
            const [conflicts] = await connection.execute(
                `SELECT COUNT(*) as conflict_count
                 FROM visit
                 WHERE caregiver_id = ? 
                 AND scheduled_time = ?
                 AND status IN ('scheduled', 'in_progress')`,
                [caregiver.caregiver_id, scheduledDateTime]
            );

            if (conflicts[0].conflict_count === 0) {
                availableCaregivers.push(caregiver);
            }
        }

        console.log('✅ Available at that time:', availableCaregivers.length);

        if (!availableCaregivers.length) {
            console.log('❌ No caregivers available at that time');
            return null;
        }

        // Get care recipient's conditions (for specialization matching)
        const [conditions] = await connection.execute(
            `SELECT condition_name FROM medical_conditions 
             WHERE care_recipient_id = ?`,
            [careRecipientId]
        );

        const conditionNames = conditions.map(c => c.condition_name.toLowerCase());

        // Score each available caregiver
        const scoredCaregivers = availableCaregivers.map(caregiver => {
            let score = 0;
            
            // Prefer professional over volunteer
            if (caregiver.type === 'professional') score += 10;
            
            // Prefer those with fewer visits today
            score += (5 - (caregiver.today_visits || 0)) * 2;
            
            // Prefer those with fewer total visits
            score += (10 - (caregiver.total_visits || 0));
            
            // Bonus for specialization matching
            if (conditionNames.some(c => c.includes('diabetes')) && caregiver.skills?.toLowerCase().includes('diabetes')) {
                score += 5;
            }
            if (conditionNames.some(c => c.includes('hypertension')) && caregiver.skills?.toLowerCase().includes('blood pressure')) {
                score += 5;
            }
            if (conditionNames.some(c => c.includes('stroke')) && caregiver.skills?.toLowerCase().includes('therapy')) {
                score += 5;
            }
            
            return { ...caregiver, score };
        });

        // Sort by score (highest first)
        scoredCaregivers.sort((a, b) => b.score - a.score);

        const selectedCaregiver = scoredCaregivers[0];
        console.log('✅ Selected caregiver:', selectedCaregiver.name);
        console.log('   Type:', selectedCaregiver.type);
        console.log('   Today\'s visits:', selectedCaregiver.today_visits);
        console.log('   Score:', selectedCaregiver.score);

        return selectedCaregiver;

    } catch (error) {
        console.error('❌ Error in auto-assign:', error);
        throw error;
    }
}
const availabilityService = require('./availabilityService');

async function autoAssignCaregiver(connection, careRecipientId, scheduledDateTime) {
    try {
        // Extract date from scheduledDateTime
        const scheduledDate = scheduledDateTime.split(' ')[0];
        
        console.log('🤖 Looking for available caregiver on:', scheduledDate);
        
        // Find best available caregiver
        const bestCaregiver = await availabilityService.findBestAvailableCaregiver(scheduledDate);
        
        if (!bestCaregiver) {
            console.log('❌ No caregivers available on', scheduledDate);
            return null;
        }
        
        console.log('✅ Assigned caregiver:', bestCaregiver.name, 'with', 
                    bestCaregiver.weekly_visits, 'visits this week');
        
        return bestCaregiver;
        
    } catch (error) {
        console.error('Error in auto-assign:', error);
        throw error;
    }
}

module.exports = autoAssignCaregiver;