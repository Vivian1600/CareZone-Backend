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

        // Step 1: Get care recipient's location and needs
        const [recipient] = await connection.execute(
            `SELECT cr.*, 
                    GROUP_CONCAT(mc.condition_name) as conditions
             FROM care_recipient cr
             LEFT JOIN medical_conditions mc ON cr.care_recipient_id = mc.care_recipient_id
             WHERE cr.care_recipient_id = ?
             GROUP BY cr.care_recipient_id`,
            [careRecipientId]
        );

        if (!recipient.length) {
            console.log('❌ Care recipient not found');
            return null;
        }

        // Step 2: Get all active caregivers
        const [allCaregivers] = await connection.execute(
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

        if (!allCaregivers.length) {
            console.log('❌ No active caregivers found');
            return null;
        }

        // Step 3: Check availability for the scheduled time
        const availableCaregivers = [];
        
        for (const caregiver of allCaregivers) {
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

        if (!availableCaregivers.length) {
            console.log('❌ No caregivers available at that time');
            return null;
        }

        // Step 4: Score and select the best caregiver
        const scoredCaregivers = availableCaregivers.map(caregiver => {
            let score = 0;
            
            // Prefer professional over volunteer
            if (caregiver.type === 'professional') score += 10;
            
            // Prefer those with fewer visits today
            score += (5 - caregiver.today_visits) * 2;
            
            // Prefer those with fewer total visits (even workload)
            score += (10 - caregiver.total_visits);
            
            return { ...caregiver, score };
        });

        // Sort by score (highest first)
        scoredCaregivers.sort((a, b) => b.score - a.score);

        const selectedCaregiver = scoredCaregivers[0];
        console.log('✅ Auto-assigned caregiver:', selectedCaregiver.name);
        console.log('   Score:', selectedCaregiver.score);
        console.log('   Today\'s visits:', selectedCaregiver.today_visits);

        return selectedCaregiver;

    } catch (error) {
        console.error('❌ Error in auto-assign:', error);
        throw error;
    }
}

module.exports = { autoAssignCaregiver };