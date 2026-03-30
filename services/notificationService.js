const { pool } = require('../config/database');

class NotificationService {
    
    /**
     * Create a notification for a user
     */
    async createNotification(userId, userType, type, title, message, relatedId = null, relatedType = null, extraData = null) {
        try {
            const [result] = await pool.execute(
                `INSERT INTO notifications 
                 (user_id, user_type, type, title, message, related_id, related_type, extra_data, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [userId, userType, type, title, message, relatedId, relatedType, extraData ? JSON.stringify(extraData) : null]
            );
            
            console.log(`✅ Notification created for user ${userId} (${userType}): ${title}`);
            return result.insertId;
        } catch (error) {
            console.error('Error creating notification:', error);
            return null;
        }
    }
    
    /**
     * Safely parse extra_data from notification
     */
    _safeParseExtraData(extraData, notificationId) {
        if (!extraData) return null;
        try {
            if (typeof extraData === 'object') {
                return extraData;
            }
            return JSON.parse(extraData);
        } catch (parseError) {
            console.error(`Error parsing extra_data for notification ${notificationId}:`, parseError);
            return null;
        }
    }
    
    /**
     * Get unread notifications for a user
     */
    async getUnreadNotifications(userId, userType) {
        try {
            const [notifications] = await pool.execute(
                `SELECT * FROM notifications 
                 WHERE user_id = ? AND user_type = ? AND is_read = false
                 ORDER BY created_at DESC`,
                [userId, userType]
            );
            
            return notifications.map(n => ({
                ...n,
                extra_data: this._safeParseExtraData(n.extra_data, n.notification_id)
            }));
        } catch (error) {
            console.error('Error fetching notifications:', error);
            return [];
        }
    }
    
    /**
     * Get all notifications for a user
     */
    async getUserNotifications(userId, userType) {
        try {
            const [notifications] = await pool.execute(
                `SELECT * FROM notifications 
                 WHERE user_id = ? AND user_type = ?
                 ORDER BY created_at DESC`,
                [userId, userType]
            );
            
            return notifications.map(n => ({
                ...n,
                extra_data: this._safeParseExtraData(n.extra_data, n.notification_id)
            }));
        } catch (error) {
            console.error('Error fetching notifications:', error);
            return [];
        }
    }
    
    /**
     * Get unread count
     */
    async getUnreadCount(userId, userType) {
        try {
            const [result] = await pool.execute(
                `SELECT COUNT(*) as count FROM notifications 
                 WHERE user_id = ? AND user_type = ? AND is_read = false`,
                [userId, userType]
            );
            return result[0].count;
        } catch (error) {
            console.error('Error getting unread count:', error);
            return 0;
        }
    }
    
    /**
     * Mark notification as read
     */
    async markAsRead(notificationId, userId) {
        try {
            const [result] = await pool.execute(
                `UPDATE notifications 
                 SET is_read = true, read_at = NOW()
                 WHERE notification_id = ? AND user_id = ?`,
                [notificationId, userId]
            );
            return result.affectedRows > 0;
        } catch (error) {
            console.error('Error marking notification as read:', error);
            return false;
        }
    }
    
    /**
     * Mark all as read
     */
    async markAllAsRead(userId, userType) {
        try {
            const [result] = await pool.execute(
                `UPDATE notifications 
                 SET is_read = true, read_at = NOW()
                 WHERE user_id = ? AND user_type = ? AND is_read = false`,
                [userId, userType]
            );
            return result.affectedRows;
        } catch (error) {
            console.error('Error marking all as read:', error);
            return 0;
        }
    }
    
    /**
     * Delete notification
     */
    async deleteNotification(notificationId, userId) {
        try {
            const [result] = await pool.execute(
                `DELETE FROM notifications WHERE notification_id = ? AND user_id = ?`,
                [notificationId, userId]
            );
            return result.affectedRows > 0;
        } catch (error) {
            console.error('Error deleting notification:', error);
            return false;
        }
    }
    
    /**
     * Clean up old notifications
     */
    async cleanupOldNotifications() {
        try {
            const [result] = await pool.execute(
                `DELETE FROM notifications 
                 WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`,
                []
            );
            console.log(`🧹 Cleaned up ${result.affectedRows} old notifications`);
            return result.affectedRows;
        } catch (error) {
            console.error('Error cleaning up notifications:', error);
            return 0;
        }
    }
    
    // =====================================================
    // HELPER METHODS
    // =====================================================
    
    /**
     * Get family members for a care recipient
     */
    async getFamilyMembersForRecipient(careRecipientId) {
        try {
            const [familyMembers] = await pool.execute(
                `SELECT fm.family_member_id as user_id, 'family_member' as user_type, 
                        fm.name, fm.contact_no as phone, fm.email
                 FROM family_member fm
                 JOIN family_links fl ON fm.family_member_id = fl.family_member_id
                 WHERE fl.care_recipient_id = ?`,
                [careRecipientId]
            );
            return familyMembers;
        } catch (error) {
            console.error('Error fetching family members:', error);
            return [];
        }
    }
    
    /**
     * Get care recipient details
     */
    async getCareRecipientDetails(careRecipientId) {
        try {
            const [recipients] = await pool.execute(
                `SELECT cr.care_recipient_id as user_id, 'care_recipient' as user_type,
                        cr.name, cr.contact_no as phone, cr.email, cr.address
                 FROM care_recipient cr
                 WHERE cr.care_recipient_id = ?`,
                [careRecipientId]
            );
            return recipients[0] || null;
        } catch (error) {
            console.error('Error fetching care recipient:', error);
            return null;
        }
    }
    
    /**
     * Get caregiver details
     */
    async getCaregiverDetails(caregiverId) {
        try {
            const [caregivers] = await pool.execute(
                `SELECT c.caregiver_id as user_id, 'caregiver' as user_type,
                        c.name, c.phone_no as phone, c.email, c.address
                 FROM caregiver c
                 WHERE c.caregiver_id = ?`,
                [caregiverId]
            );
            return caregivers[0] || null;
        } catch (error) {
            console.error('Error fetching caregiver:', error);
            return null;
        }
    }
    
    /**
     * Get caregiver details from visit
     */
    async getCaregiverDetailsFromVisit(visitId) {
        try {
            const [visits] = await pool.execute(
                `SELECT c.caregiver_id, c.name, c.phone_no as phone, c.address
                 FROM visit v
                 JOIN caregiver c ON v.caregiver_id = c.caregiver_id
                 WHERE v.visit_id = ?`,
                [visitId]
            );
            return visits[0] || null;
        } catch (error) {
            console.error('Error fetching caregiver from visit:', error);
            return null;
        }
    }
    
    // =====================================================
    // NOTIFICATION METHODS
    // =====================================================
    
    /**
     * 1. VISIT SCHEDULED - Notify caregiver
     */
    async notifyVisitScheduled(visitId, caregiverId, caregiverName, recipientName, scheduledTime) {
        const formattedDate = new Date(scheduledTime).toLocaleDateString();
        const formattedTime = new Date(scheduledTime).toLocaleTimeString();
        
        const message = `📅 New visit scheduled!\n\n` +
            `Patient: ${recipientName}\n` +
            `Date: ${formattedDate}\n` +
            `Time: ${formattedTime}\n\n` +
            `Please confirm this visit at your earliest convenience.`;
        
        await this.createNotification(
            caregiverId,
            'caregiver',
            'visit_scheduled',
            '📅 New Visit Scheduled',
            message,
            visitId,
            'visit',
            { scheduled_time: scheduledTime, patient: recipientName }
        );
        
        console.log(`📧 Visit scheduled notification sent to caregiver ${caregiverId}`);
        return true;
    }
    
    /**
     * 2. CAREGIVER ACCEPTS - Notify family, care recipient, and caregiver (receipt)
     */
    async notifyVisitAcknowledged(visitId, careRecipientId, caregiverId, scheduledTime) {
        // Get caregiver details
        const caregiver = await this.getCaregiverDetails(caregiverId);
        if (!caregiver) {
            console.error('Caregiver not found:', caregiverId);
            return false;
        }
        
        // Get care recipient details
        const careRecipient = await this.getCareRecipientDetails(careRecipientId);
        if (!careRecipient) {
            console.error('Care recipient not found:', careRecipientId);
            return false;
        }
        
        const formattedDate = new Date(scheduledTime).toLocaleDateString();
        const formattedTime = new Date(scheduledTime).toLocaleTimeString();
        
        // 2a. Notify FAMILY MEMBERS
        const familyMembers = await this.getFamilyMembersForRecipient(careRecipientId);
        for (const family of familyMembers) {
            const familyMessage = `✅ Visit Confirmed!\n\n` +
                `Caregiver ${caregiver.name} has confirmed the visit with ${careRecipient.name}.\n\n` +
                `📅 Date: ${formattedDate}\n` +
                `⏰ Time: ${formattedTime}\n\n` +
                `👨‍⚕️ Caregiver Details:\n` +
                `   Name: ${caregiver.name}\n` +
                `   Phone: ${caregiver.phone || 'Not provided'}\n` +
                `   Address: ${caregiver.address || 'Not provided'}\n\n` +
                `The caregiver will arrive at the scheduled time.`;
            
            await this.createNotification(
                family.user_id,
                'family_member',
                'visit_acknowledged',
                '✅ Visit Confirmed',
                familyMessage,
                visitId,
                'visit',
                { caregiver: caregiver, care_recipient: careRecipient, scheduled_time: scheduledTime }
            );
            console.log(`📧 Visit confirmed notification sent to family member ${family.user_id}`);
        }
        
        // 2b. Notify CARE RECIPIENT
        const recipientMessage = `✅ Your visit has been confirmed!\n\n` +
            `📅 Date: ${formattedDate}\n` +
            `⏰ Time: ${formattedTime}\n\n` +
            `👨‍⚕️ Your Caregiver:\n` +
            `   Name: ${caregiver.name}\n` +
            `   Phone: ${caregiver.phone || 'Not provided'}\n` +
            `   Address: ${caregiver.address || 'Not provided'}\n\n` +
            `Please be ready at the scheduled time.`;
        
        await this.createNotification(
            careRecipient.user_id,
            'care_recipient',
            'visit_acknowledged',
            '✅ Visit Confirmed',
            recipientMessage,
            visitId,
            'visit',
            { caregiver: caregiver, scheduled_time: scheduledTime }
        );
        console.log(`📧 Visit confirmed notification sent to care recipient ${careRecipient.user_id}`);
        
        // 2c. Notify CAREGIVER (Confirmation Receipt)
        const caregiverReceiptMessage = `✅ You have confirmed the visit!\n\n` +
            `Patient: ${careRecipient.name}\n` +
            `📅 Date: ${formattedDate}\n` +
            `⏰ Time: ${formattedTime}\n\n` +
            `Patient Address: ${careRecipient.address || 'Not provided'}\n` +
            `Emergency Contact: ${careRecipient.phone || 'Not provided'}\n\n` +
            `Thank you for confirming. Please arrive on time.`;
        
        await this.createNotification(
            caregiver.user_id,
            'caregiver',
            'visit_acknowledged',
            '✅ Visit Confirmed',
            caregiverReceiptMessage,
            visitId,
            'visit',
            { patient: careRecipient, scheduled_time: scheduledTime }
        );
        console.log(`📧 Confirmation receipt sent to caregiver ${caregiver.user_id}`);
        
        return true;
    }
    
    /**
     * 3. CAREGIVER DECLINES - Notify family and care recipient
     */
    async notifyVisitDeclined(visitId, careRecipientId, caregiverName, recipientName, reason, scheduledTime) {
        const formattedDate = new Date(scheduledTime).toLocaleDateString();
        const formattedTime = new Date(scheduledTime).toLocaleTimeString();
        
        const familyMembers = await this.getFamilyMembersForRecipient(careRecipientId);
        const careRecipient = await this.getCareRecipientDetails(careRecipientId);
        
        for (const family of familyMembers) {
            const message = `❌ Visit Declined\n\n` +
                `Caregiver ${caregiverName} has declined the visit with ${recipientName}.\n\n` +
                `📅 Date: ${formattedDate}\n` +
                `⏰ Time: ${formattedTime}\n` +
                `Reason: ${reason || 'Not specified'}\n\n` +
                `Please schedule another time.`;
            
            await this.createNotification(
                family.user_id,
                'family_member',
                'visit_declined',
                '❌ Visit Declined',
                message,
                visitId,
                'visit',
                { reason: reason, scheduled_time: scheduledTime }
            );
        }
        
        // Also notify care recipient
        if (careRecipient) {
            const recipientMessage = `❌ Visit Declined\n\n` +
                `Your visit scheduled for ${formattedDate} at ${formattedTime} has been declined by the caregiver.\n\n` +
                `Reason: ${reason || 'Not specified'}\n\n` +
                `Your family member will schedule another time.`;
            
            await this.createNotification(
                careRecipient.user_id,
                'care_recipient',
                'visit_declined',
                '❌ Visit Declined',
                recipientMessage,
                visitId,
                'visit'
            );
        }
        
        console.log(`📧 Visit declined notifications sent to ${familyMembers.length} family members and care recipient`);
    }
    
    /**
     * 4. VISIT REMINDER - 30 minutes before (caregiver, family, care recipient)
     */
    async sendVisitReminders() {
        try {
            const thirtyMinutesFromNow = new Date(Date.now() + 30 * 60000);
            const thirtyMinutesLater = new Date(Date.now() + 31 * 60000);
            
            const [visits] = await pool.execute(
                `SELECT v.*, cr.name as recipient_name, cr.address as recipient_address,
                        cg.name as caregiver_name, cg.phone_no as caregiver_phone, cg.address as caregiver_address
                 FROM visit v
                 JOIN care_recipient cr ON v.care_recipient_id = cr.care_recipient_id
                 JOIN caregiver cg ON v.caregiver_id = cg.caregiver_id
                 WHERE v.scheduled_time BETWEEN ? AND ?
                   AND v.status IN ('scheduled', 'confirmed')
                   AND v.acknowledged = true`,
                [thirtyMinutesFromNow, thirtyMinutesLater]
            );
            
            for (const visit of visits) {
                const formattedTime = new Date(visit.scheduled_time).toLocaleTimeString();
                const formattedDate = new Date(visit.scheduled_time).toLocaleDateString();
                
                // 4a. Notify CAREGIVER
                await this.createNotification(
                    visit.caregiver_id,
                    'caregiver',
                    'visit_reminder',
                    '⏰ Visit Reminder',
                    `Your visit with ${visit.recipient_name} starts in 30 minutes at ${formattedTime}.\n\n` +
                    `Patient Address: ${visit.recipient_address || 'Not provided'}\n` +
                    `Please ensure you're on time.`,
                    visit.visit_id,
                    'visit'
                );
                
                // 4b. Notify CARE RECIPIENT
                await this.createNotification(
                    visit.care_recipient_id,
                    'care_recipient',
                    'visit_reminder',
                    '⏰ Visit Reminder',
                    `Your caregiver ${visit.caregiver_name} will arrive in 30 minutes at ${formattedTime}.\n\n` +
                    `Caregiver Phone: ${visit.caregiver_phone || 'Available in app'}\n` +
                    `Please be ready.`,
                    visit.visit_id,
                    'visit',
                    { caregiver: { name: visit.caregiver_name, phone: visit.caregiver_phone } }
                );
                
                // 4c. Notify FAMILY MEMBERS
                const familyMembers = await this.getFamilyMembersForRecipient(visit.care_recipient_id);
                for (const family of familyMembers) {
                    await this.createNotification(
                        family.user_id,
                        'family_member',
                        'visit_reminder',
                        '⏰ Visit Reminder',
                        `A visit with ${visit.recipient_name} starts in 30 minutes at ${formattedTime}.\n\n` +
                        `Caregiver: ${visit.caregiver_name}\n` +
                        `Caregiver Phone: ${visit.caregiver_phone || 'Available in app'}\n` +
                        `Date: ${formattedDate}`,
                        visit.visit_id,
                        'visit',
                        { caregiver: { name: visit.caregiver_name, phone: visit.caregiver_phone } }
                    );
                }
            }
            
            console.log(`📧 Sent ${visits.length} visit reminders to all parties`);
            return visits.length;
        } catch (error) {
            console.error('Error sending visit reminders:', error);
            return 0;
        }
    }
    
    /**
     * 5. VISIT COMPLETED - Notify family, care recipient, caregiver
     */
    async notifyVisitCompleted(visitId, careRecipientId, caregiverName, recipientName, completedTime) {
        const formattedDate = new Date(completedTime).toLocaleDateString();
        const formattedTime = new Date(completedTime).toLocaleTimeString();
        
        // Get caregiver details
        const caregiver = await this.getCaregiverDetailsFromVisit(visitId);
        const careRecipient = await this.getCareRecipientDetails(careRecipientId);
        
        // 5a. Notify FAMILY MEMBERS
        const familyMembers = await this.getFamilyMembersForRecipient(careRecipientId);
        for (const family of familyMembers) {
            const message = `✅ Visit Completed!\n\n` +
                `Caregiver ${caregiverName} has completed the visit with ${recipientName}.\n\n` +
                `📅 Date: ${formattedDate}\n` +
                `⏰ Time: ${formattedTime}\n\n` +
                `Caregiver Contact: ${caregiver?.phone || 'Available in app'}\n\n` +
                `You can view the full visit report in the app.`;
            
            await this.createNotification(
                family.user_id,
                'family_member',
                'visit_completed',
                '✅ Visit Completed',
                message,
                visitId,
                'visit',
                { caregiver: caregiver, completed_time: completedTime }
            );
        }
        
        // 5b. Notify CARE RECIPIENT
        if (careRecipient) {
            const recipientMessage = `✅ Visit Completed!\n\n` +
                `Your visit with ${caregiverName} has been completed on ${formattedDate} at ${formattedTime}.\n\n` +
                `Thank you for using our service!`;
            
            await this.createNotification(
                careRecipient.user_id,
                'care_recipient',
                'visit_completed',
                '✅ Visit Completed',
                recipientMessage,
                visitId,
                'visit'
            );
        }
        
        // 5c. Notify CAREGIVER
        if (caregiver) {
            await this.createNotification(
                caregiver.caregiver_id,
                'caregiver',
                'visit_completed',
                '✅ Visit Completed',
                `You have successfully completed the visit with ${recipientName} on ${formattedDate} at ${formattedTime}.\n\n` +
                `Thank you for your service!`,
                visitId,
                'visit'
            );
        }
        
        console.log(`📧 Visit completed notifications sent to ${familyMembers.length} family members, care recipient, and caregiver`);
    }
    
    /**
     * 6. REPORT READY - Notify family
     */
    async notifyReportReady(familyMemberId, recipientName, weekStart, weekEnd) {
        await this.createNotification(
            familyMemberId,
            'family_member',
            'report_ready',
            '📊 Weekly Report Ready',
            `The weekly report for ${recipientName} (${weekStart} to ${weekEnd}) is now available to view.\n\n` +
            `Tap to see the full report with visit summaries and medication adherence.`,
            null,
            'report'
        );
        console.log(`📧 Sent report ready notification to family member ${familyMemberId}`);
    }
}

module.exports = new NotificationService();