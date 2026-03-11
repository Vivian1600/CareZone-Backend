/**
 * SMS Notification Service
 * Mock implementation - can be replaced with real SMS provider (Twilio, AWS SNS, etc.)
 */

class SMSService {
    /**
     * Send SMS notification
     * @param {string} phoneNumber - Recipient phone number
     * @param {string} message - SMS message content
     * @param {string} recipientType - 'caregiver' or 'care_recipient'
     * @param {string} recipientName - Name of recipient
     * @returns {Promise<{success: boolean, messageId: string}>}
     */
    static async sendSMS(phoneNumber, message, recipientType = 'user', recipientName = '') {
        try {
            // Mock SMS implementation - logs to console and database
            const timestamp = new Date().toISOString();
            console.log(`📱 SMS NOTIFICATION [${timestamp}]`);
            console.log(`   To: ${recipientName} (${phoneNumber})`);
            console.log(`   Type: ${recipientType}`);
            console.log(`   Message: ${message}`);
            console.log('');

            // In production, replace with actual SMS provider:
            // const result = await twilio.messages.create({
            //     body: message,
            //     from: process.env.TWILIO_PHONE_NUMBER,
            //     to: phoneNumber
            // });
            // return { success: true, messageId: result.sid };

            // Mock response
            return {
                success: true,
                messageId: `mock_${Date.now()}`,
                timestamp: timestamp,
                recipientType: recipientType
            };
        } catch (error) {
            console.error('❌ SMS Error:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Send visit scheduled notification
     */
    static async notifyVisitScheduled(caregiver, careRecipient, visitDateTime) {
        // Notify caregiver
        const caregiverMessage = `You have been assigned to care for ${careRecipient.name} on ${visitDateTime}. Please confirm your availability.`;
        await this.sendSMS(caregiver.phone_no, caregiverMessage, 'caregiver', caregiver.name);

        // Notify care recipient
        const recipientMessage = `A visit has been scheduled with ${caregiver.name} on ${visitDateTime}.`;
        if (careRecipient.contact_no) {
            await this.sendSMS(careRecipient.contact_no, recipientMessage, 'care_recipient', careRecipient.name);
        }
    }

    /**
     * Send visit started notification
     */
    static async notifyVisitStarted(caregiver, careRecipient) {
        const message = `Visit with ${careRecipient.name} started. Please update task status as you complete them.`;
        await this.sendSMS(caregiver.phone_no, message, 'caregiver', caregiver.name);
    }

    /**
     * Send visit completed notification
     */
    static async notifyVisitCompleted(caregiver, careRecipient, familyMembers) {
        // Notify caregiver
        const caregiverMsg = `Visit with ${careRecipient.name} completed. Thank you for your service.`;
        await this.sendSMS(caregiver.phone_no, caregiverMsg, 'caregiver', caregiver.name);

        // Notify care recipient
        const recipientMsg = `Your visit with ${caregiver.name} is complete.`;
        if (careRecipient.contact_no) {
            await this.sendSMS(careRecipient.contact_no, recipientMsg, 'care_recipient', careRecipient.name);
        }

        // Notify family members
        for (const family of familyMembers) {
            const familyMsg = `Visit with ${careRecipient.name} completed by ${caregiver.name}.`;
            await this.sendSMS(family.contact_no, familyMsg, 'family_member', family.name);
        }
    }
}

module.exports = SMSService;
