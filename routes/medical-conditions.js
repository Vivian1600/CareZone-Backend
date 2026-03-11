// routes/medical-conditions.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const authMiddleware = require('../middleware/auth');

/**
 * @route   POST /api/medical-conditions
 * @desc    Add a medical condition for a care recipient
 * @access  Private
 */
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        const { care_recipient_id, condition_name, description } = req.body;

        console.log('=================================');
        console.log('🏥 Creating Medical Condition');
        console.log('Care Recipient ID:', care_recipient_id);
        console.log('Condition:', condition_name);
        console.log('=================================');

        // Validate required fields
        if (!care_recipient_id || !condition_name) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: care_recipient_id, condition_name'
            });
        }

        // Verify care recipient exists
        const [careRecipient] = await pool.execute(
            'SELECT care_recipient_id FROM care_recipient WHERE care_recipient_id = ?',
            [care_recipient_id]
        );

        if (careRecipient.length === 0) {
            console.log('❌ Care recipient not found');
            return res.status(404).json({
                success: false,
                message: 'Care recipient not found'
            });
        }

        // Create medical condition
        const [result] = await pool.execute(
            `INSERT INTO medical_conditions 
            (care_recipient_id, condition_name, description) 
            VALUES (?, ?, ?)`,
            [care_recipient_id, condition_name, description || null]
        );

        console.log('✅ Medical condition created successfully');
        console.log('   ID:', result.insertId);
        console.log('=================================');

        res.status(201).json({
            success: true,
            message: 'Medical condition created successfully',
            condition: {
                condition_id: result.insertId,
                care_recipient_id,
                condition_name,
                description: description || null
            }
        });
    } catch (error) {
        console.error('❌ Error creating medical condition:', error);
        next(error);
    }
});

/**
 * @route   GET /api/medical-conditions/care-recipient/:careRecipientId
 * @desc    Get all medical conditions for a care recipient
 * @access  Private
 */
router.get('/care-recipient/:careRecipientId', authMiddleware, async (req, res, next) => {
    try {
        const { careRecipientId } = req.params;

        console.log('📋 Fetching medical conditions for care recipient:', careRecipientId);

        const [conditions] = await pool.execute(
            `SELECT condition_id, care_recipient_id, condition_name, description, created_at
             FROM medical_conditions 
             WHERE care_recipient_id = ?
             ORDER BY created_at DESC`,
            [careRecipientId]
        );

        console.log('✅ Found', conditions.length, 'medical conditions');

        res.json({
            success: true,
            conditions
        });
    } catch (error) {
        console.error('❌ Error fetching medical conditions:', error);
        next(error);
    }
});

/**
 * @route   PUT /api/medical-conditions/:conditionId
 * @desc    Update a medical condition
 * @access  Private
 */
router.put('/:conditionId', authMiddleware, async (req, res, next) => {
    try {
        const { conditionId } = req.params;
        const { condition_name, description } = req.body;

        console.log('🏥 Updating medical condition:', conditionId);

        const [result] = await pool.execute(
            `UPDATE medical_conditions 
             SET condition_name = COALESCE(?, condition_name),
                 description = COALESCE(?, description)
             WHERE condition_id = ?`,
            [condition_name, description, conditionId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Medical condition not found'
            });
        }

        console.log('✅ Medical condition updated successfully');

        res.json({
            success: true,
            message: 'Medical condition updated successfully'
        });
    } catch (error) {
        console.error('❌ Error updating medical condition:', error);
        next(error);
    }
});

/**
 * @route   DELETE /api/medical-conditions/:conditionId
 * @desc    Delete a medical condition
 * @access  Private
 */
router.delete('/:conditionId', authMiddleware, async (req, res, next) => {
    try {
        const { conditionId } = req.params;

        console.log('🗑️ Deleting medical condition:', conditionId);

        const [result] = await pool.execute(
            'DELETE FROM medical_conditions WHERE condition_id = ?',
            [conditionId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Medical condition not found'
            });
        }

        console.log('✅ Medical condition deleted successfully');

        res.json({
            success: true,
            message: 'Medical condition deleted successfully'
        });
    } catch (error) {
        console.error('❌ Error deleting medical condition:', error);
        next(error);
    }
});

module.exports = router;
