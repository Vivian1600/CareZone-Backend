const { pool } = require('../config/database');

class NotificationService {
    
    async createNotification(userId, userType, type, title, message, relatedId = null, relatedType = null, extraData = null) {
        try {
            const [result] = await pool.execute(
                `INSERT INTO notifications 
                 (user_id, user_type, type, title, message, related_id, related_type, extra_data, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [userId, userType, type, title, message, relatedId, relatedType, extraData ? JSON.stringify(extraData) : null]
            );
            
            console.log(`✅ Notification created for user ${userId}: ${title}`);
            return result.insertId;
        } catch (error) {
            console.error('Error creating notification:', error);
            return null;
        }
    }
    
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
                extra_data: n.extra_data ? JSON.parse(n.extra_data) : null
            }));
        } catch (error) {
            console.error('Error fetching notifications:', error);
            return [];
        }
    }
    
    async getUserNotifications(userId, userType, limit = 50, offset = 0) {
        try {
            // Simplified - get all notifications without pagination for now
            const [notifications] = await pool.execute(
                `SELECT * FROM notifications 
                 WHERE user_id = ? AND user_type = ?
                 ORDER BY created_at DESC`,
                [userId, userType]
            );
            
            return notifications.map(n => ({
                ...n,
                extra_data: n.extra_data ? JSON.parse(n.extra_data) : null
            }));
        } catch (error) {
            console.error('Error fetching notifications:', error);
            return [];
        }
    }
    
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
    
    // Notification methods...
    async notifyVisitScheduled(visitId, caregiverId, caregiverName, recipientName, scheduledTime) {
        const formattedDate = new Date(scheduledTime).toLocaleDateString();
        const formattedTime = new Date(scheduledTime).toLocaleTimeString();
        
        await this.createNotification(
            caregiverId,
            'caregiver',
            'visit_scheduled',
            'New Visit Scheduled',
            `You have a new visit scheduled with ${recipientName} on ${formattedDate} at ${formattedTime}`,
            visitId,
            'visit'
        );
        return true;
    }
    
    async notifyVisitAcknowledged(visitId, careRecipientId, caregiverId, scheduledTime) {
        const caregiver = await this.getCaregiverDetails(caregiverId);
        if (!caregiver) return false;
        
        const formattedDate = new Date(scheduledTime).toLocaleDateString();
        const formattedTime = new Date(scheduledTime).toLocaleTimeString();
        
        const careRecipient = await this.getCareRecipientDetails(careRecipientId);
        if (careRecipient) {
            await this.createNotification(
                careRecipient.user_id,
                'care_recipient',
                'visit_acknowledged',
                '✓ Visit Confirmed',
                `✅ Visit confirmed!\n\n📅 ${formattedDate} at ${formattedTime}\n\n👨‍⚕️ Caregiver: ${caregiver.name}\n📞 ${caregiver.phone || 'Not provided'}\n📍 ${caregiver.address || 'Not provided'}`,
                visitId,
                'visit',
                { caregiver }
            );
        }
        
        const familyMembers = await this.getFamilyMembersForRecipient(careRecipientId);
        for (const family of familyMembers) {
            await this.createNotification(
                family.user_id,
                'family_member',
                'visit_acknowledged',
                '✓ Visit Confirmed',
                `✅ Visit confirmed for ${careRecipient?.name || 'your loved one'}!\n\n📅 ${formattedDate} at ${formattedTime}\n\n👨‍⚕️ Caregiver: ${caregiver.name}\n📞 ${caregiver.phone || 'Not provided'}\n📍 ${caregiver.address || 'Not provided'}`,
                visitId,
                'visit',
                { caregiver, care_recipient: careRecipient }
            );
        }
        return true;
    }
    
    async notifyVisitDeclined(visitId, careRecipientId, caregiverName, recipientName, reason, scheduledTime) {
        const formattedDate = new Date(scheduledTime).toLocaleDateString();
        const formattedTime = new Date(scheduledTime).toLocaleTimeString();
        
        const familyMembers = await this.getFamilyMembersForRecipient(careRecipientId);
        for (const family of familyMembers) {
            await this.createNotification(
                family.user_id,
                'family_member',
                'visit_declined',
                '❌ Visit Declined',
                `Caregiver ${caregiverName} declined the visit with ${recipientName} on ${formattedDate} at ${formattedTime}.\nReason: ${reason || 'Not specified'}`,
                visitId,
                'visit'
            );
        }
    }
    
    async notifyVisitCompleted(visitId, careRecipientId, caregiverName, recipientName, completedTime) {
        const formattedDate = new Date(completedTime).toLocaleDateString();
        const formattedTime = new Date(completedTime).toLocaleTimeString();
        const caregiver = await this.getCaregiverDetailsFromVisit(visitId);
        
        const careRecipient = await this.getCareRecipientDetails(careRecipientId);
        if (careRecipient) {
            await this.createNotification(
                careRecipient.user_id,
                'care_recipient',
                'visit_completed',
                '✅ Visit Completed',
                `Your visit with ${caregiverName} was completed on ${formattedDate} at ${formattedTime}. Thank you!`,
                visitId,
                'visit'
            );
        }
        
        const familyMembers = await this.getFamilyMembersForRecipient(careRecipientId);
        for (const family of familyMembers) {
            await this.createNotification(
                family.user_id,
                'family_member',
                'visit_completed',
                '✅ Visit Completed',
                `Caregiver ${caregiverName} completed the visit with ${recipientName} on ${formattedDate} at ${formattedTime}.\nCaregiver Contact: ${caregiver?.phone || 'Available in app'}`,
                visitId,
                'visit',
                { caregiver }
            );
        }
    }
    
    async notifyReportReady(familyMemberId, recipientName, weekStart, weekEnd) {
        await this.createNotification(
            familyMemberId,
            'family_member',
            'report_ready',
            '📊 Weekly Report Ready',
            `The weekly report for ${recipientName} (${weekStart} to ${weekEnd}) is now available.`,
            null,
            'report'
        );
    }
}

module.exports = new NotificationService();