const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { isFamilyMember, isCaregiver } = require('../middleware/role');

/**
 * @route   POST /api/medications
 * @desc    Create a new medication for a care recipient
 * @access  Private (Caregiver or Family)
 */
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        const { care_recipient_id, name, dosage, frequency, medical_condition, instructions } = req.body;

        console.log('=================================');
        console.log('💊 Creating Medication');
        console.log('Care Recipient ID:', care_recipient_id);
        console.log('Medication Name:', name);
        console.log('=================================');

        // Validate required fields
        if (!care_recipient_id || !name || !dosage || !frequency) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: care_recipient_id, name, dosage, frequency'
            });
        }

        let finalMedicalCondition = medical_condition;

        // If medical_condition is not provided, fetch from care_recipient
        if (!medical_condition) {
            console.log('📋 Fetching care recipient medical condition...');
            const [careRecipient] = await pool.execute(
                `SELECT medical_condition FROM care_recipient WHERE care_recipient_id = ?`,
                [care_recipient_id]
            );

            if (careRecipient.length === 0) {
                console.log('❌ Care recipient not found');
                return res.status(404).json({
                    success: false,
                    message: 'Care recipient not found'
                });
            }

            finalMedicalCondition = careRecipient[0].medical_condition || 'Unspecified';
            console.log('✅ Medical condition from care recipient:', finalMedicalCondition);
        }

        // Ensure medical_condition is NOT NULL
        if (!finalMedicalCondition) {
            finalMedicalCondition = 'Unspecified';
        }

        // Create medication
        const [result] = await pool.execute(
            `INSERT INTO medication 
            (care_recipient_id, name, dosage, frequency, medical_condition, instructions, is_active, start_date) 
            VALUES (?, ?, ?, ?, ?, ?, 1, CURDATE())`,
            [care_recipient_id, name, dosage, frequency, finalMedicalCondition, instructions || null]
        );

        console.log('✅ Medication created successfully');
        console.log('   ID:', result.insertId);
        console.log('   Medical Condition:', finalMedicalCondition);
        console.log('=================================');

        res.status(201).json({
            success: true,
            message: 'Medication created successfully',
            data: {
                medication_id: result.insertId,
                care_recipient_id,
                name,
                dosage,
                frequency,
                medical_condition: finalMedicalCondition,
                instructions: instructions || null
            }
        });
    } catch (error) {
        console.error('❌ Error creating medication:', error);
        next(error);
    }
});

/**
 * @route   GET /api/medications/care-recipient/:careRecipientId
 * @desc    Get all active medications for a care recipient
 * @access  Private (Caregiver or Family)
 */
router.get('/care-recipient/:careRecipientId', authMiddleware, async (req, res, next) => {
    try {
        const { careRecipientId } = req.params;

        console.log('📋 Fetching medications for care recipient:', careRecipientId);

        const [medications] = await pool.execute(
            `SELECT medication_id, name, dosage, frequency, medical_condition, 
                    instructions, is_active, start_date, end_date, created_at
             FROM medication 
             WHERE care_recipient_id = ? 
               AND is_active = 1
               AND (end_date IS NULL OR end_date >= CURDATE())
             ORDER BY created_at DESC`,
            [careRecipientId]
        );

        console.log('✅ Found', medications.length, 'medications');

        res.json({
            success: true,
            data: medications
        });
    } catch (error) {
        console.error('❌ Error fetching medications:', error);
        next(error);
    }
});

/**
 * @route   GET /api/medications/visit/:visitId
 * @desc    Get medications for a specific visit (with administration status)
 * @access  Private (Caregiver)
 */
router.get('/visit/:visitId', authMiddleware, async (req, res, next) => {
    try {
        const { visitId } = req.params;

        // First get the visit to know which care recipient
        const [visits] = await pool.execute(
            `SELECT care_recipient_id FROM visit WHERE visit_id = ?`,
            [visitId]
        );

        if (visits.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Visit not found'
            });
        }

        const care_recipient_id = visits[0].care_recipient_id;

        // Get all active medications and whether they were administered during this visit
        const [medications] = await pool.execute(
            `SELECT m.*, 
                    ma.administered, 
                    ma.dose_given, 
                    ma.administered_time,
                    ma.side_effects_observed,
                    ma.reason_not_given,
                    ma.notes as admin_notes,
                    ma.administration_id
             FROM medication m
             LEFT JOIN medication_administration ma 
                ON ma.medication_id = m.medication_id 
                AND ma.visit_id = ?
             WHERE m.care_recipient_id = ?
               AND m.is_active = 1
               AND (m.end_date IS NULL OR m.end_date >= CURDATE())
             ORDER BY m.name`,
            [visitId, care_recipient_id]
        );

        res.json({
            success: true,
            data: medications
        });
    } catch (error) {
        console.error('❌ Error fetching visit medications:', error);
        next(error);
    }
});

/**
 * @route   GET /api/medications/history/:careRecipientId
 * @desc    Get medication history (including discontinued) for a care recipient
 * @access  Private (Family Member)
 */
router.get('/history/:careRecipientId', authMiddleware, isFamilyMember, async (req, res, next) => {
    try {
        const { careRecipientId } = req.params;

        console.log('📋 Fetching medication history for care recipient:', careRecipientId);

        const [medications] = await pool.execute(
            `SELECT medication_id, name, dosage, frequency, medical_condition, 
                    instructions, is_active, start_date, end_date, created_at
             FROM medication 
             WHERE care_recipient_id = ?
             ORDER BY created_at DESC`,
            [careRecipientId]
        );

        console.log('✅ Found', medications.length, 'medications (including discontinued)');

        res.json({
            success: true,
            data: medications
        });
    } catch (error) {
        console.error('❌ Error fetching medication history:', error);
        next(error);
    }
});

/**
 * @route   PUT /api/medications/:medicationId
 * @desc    Update a medication
 * @access  Private (Caregiver or Family)
 */
router.put('/:medicationId', authMiddleware, async (req, res, next) => {
    try {
        const { medicationId } = req.params;
        const { name, dosage, frequency, medical_condition, instructions, is_active, end_date } = req.body;

        console.log('💊 Updating medication:', medicationId);

        const [result] = await pool.execute(
            `UPDATE medication 
             SET name = COALESCE(?, name), 
                 dosage = COALESCE(?, dosage), 
                 frequency = COALESCE(?, frequency),
                 medical_condition = COALESCE(?, medical_condition),
                 instructions = COALESCE(?, instructions),
                 is_active = COALESCE(?, is_active),
                 end_date = COALESCE(?, end_date)
             WHERE medication_id = ?`,
            [name, dosage, frequency, medical_condition, instructions, is_active, end_date, medicationId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Medication not found'
            });
        }

        console.log('✅ Medication updated successfully');

        res.json({
            success: true,
            message: 'Medication updated successfully'
        });
    } catch (error) {
        console.error('❌ Error updating medication:', error);
        next(error);
    }
});

/**
 * @route   DELETE /api/medications/:medicationId
 * @desc    Delete a medication (soft delete)
 * @access  Private (Caregiver or Family)
 */
router.delete('/:medicationId', authMiddleware, async (req, res, next) => {
    try {
        const { medicationId } = req.params;

        console.log('🗑️ Deleting medication:', medicationId);

        const [result] = await pool.execute(
            `UPDATE medication SET is_active = 0, end_date = CURDATE() WHERE medication_id = ?`,
            [medicationId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Medication not found'
            });
        }

        console.log('✅ Medication deleted successfully');

        res.json({
            success: true,
            message: 'Medication discontinued successfully'
        });
    } catch (error) {
        console.error('❌ Error deleting medication:', error);
        next(error);
    }
});

module.exports = router;