const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const authMiddleware = require('../middleware/auth');

/**
 * @route   POST /api/medication-admin/log
 * @desc    Log medication administration during a visit
 * @access  Private (Caregiver only)
 */
router.post('/log', authMiddleware, async (req, res, next) => {
    try {
        const { medication_id, visit_id, administered, dose_given, notes } = req.body;
        const caregiver_id = req.user.id;

        console.log('=================================');
        console.log('💊 Logging Medication Administration');
        console.log('Medication ID:', medication_id);
        console.log('Visit ID:', visit_id);
        console.log('Administered:', administered);
        console.log('=================================');

        // Validate required fields
        if (!medication_id || !visit_id) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: medication_id, visit_id'
            });
        }

        // Verify the visit belongs to this caregiver
        const [visit] = await pool.execute(
            `SELECT visit_id FROM visit 
             WHERE visit_id = ? AND caregiver_id = ?`,
            [visit_id, caregiver_id]
        );

        if (visit.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized - This visit does not belong to you'
            });
        }

        // Check if already logged for this medication and visit
        const [existing] = await pool.execute(
            `SELECT id FROM medication_administration 
             WHERE medication_id = ? AND visit_id = ?`,
            [medication_id, visit_id]
        );

        let result;
        
        if (existing.length > 0) {
            // Update existing log
            [result] = await pool.execute(
                `UPDATE medication_administration 
                 SET administered = ?,
                     dose_given = ?,
                     notes = ?
                 WHERE medication_id = ? AND visit_id = ?`,
                [administered, dose_given, notes, medication_id, visit_id]
            );
            console.log('✅ Updated existing log');
        } else {
            // Create new log
            [result] = await pool.execute(
                `INSERT INTO medication_administration 
                 (medication_id, visit_id, caregiver_id, administered, dose_given, notes)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [medication_id, visit_id, caregiver_id, administered, dose_given, notes]
            );
            console.log('✅ Created new log');
        }

        res.json({
            success: true,
            message: existing.length > 0 ? 'Medication log updated' : 'Medication logged successfully',
            log_id: existing.length > 0 ? existing[0].id : result.insertId
        });

    } catch (error) {
        console.error('❌ Error logging medication:', error);
        next(error);
    }
});

/**
 * @route   GET /api/medication-admin/visit/:visitId
 * @desc    Get all medication logs for a specific visit
 * @access  Private (Caregiver, Family, Coordinator)
 */
router.get('/visit/:visitId', authMiddleware, async (req, res, next) => {
    try {
        const { visitId } = req.params;

        console.log('📋 Fetching medication logs for visit:', visitId);

        const [logs] = await pool.execute(
            `SELECT ma.*, m.name as medication_name, m.dosage, m.frequency
             FROM medication_administration ma
             JOIN medication m ON ma.medication_id = m.medication_id
             WHERE ma.visit_id = ?
             ORDER BY ma.created_at DESC`,
            [visitId]
        );

        console.log('✅ Found', logs.length, 'medication logs');

        res.json({
            success: true,
            logs
        });

    } catch (error) {
        console.error('❌ Error fetching medication logs:', error);
        next(error);
    }
});

/**
 * @route   GET /api/medication-admin/care-recipient/:careRecipientId
 * @desc    Get medication administration history for a care recipient
 * @access  Private (Caregiver, Family, Coordinator)
 */
router.get('/care-recipient/:careRecipientId', authMiddleware, async (req, res, next) => {
    try {
        const { careRecipientId } = req.params;
        const { days = 30 } = req.query; // Default to last 30 days

        console.log('📋 Fetching medication history for care recipient:', careRecipientId);

        const [history] = await pool.execute(
            `SELECT ma.*, 
                    m.name as medication_name, 
                    m.dosage, 
                    m.frequency,
                    v.scheduled_time as visit_date,
                    u.name as caregiver_name
             FROM medication_administration ma
             JOIN medication m ON ma.medication_id = m.medication_id
             JOIN visit v ON ma.visit_id = v.visit_id
             JOIN caregiver c ON ma.caregiver_id = c.caregiver_id
             WHERE m.care_recipient_id = ?
               AND v.scheduled_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
             ORDER BY v.scheduled_time DESC`,
            [careRecipientId, days]
        );

        // Calculate adherence rate
        const total = history.length;
        const given = history.filter(h => h.administered === 1).length;
        const adherence_rate = total > 0 ? Math.round((given / total) * 100) : 0;

        console.log('✅ Found', total, 'records. Adherence rate:', adherence_rate + '%');

        res.json({
            success: true,
            history,
            summary: {
                total_medications: total,
                times_given: given,
                times_missed: total - given,
                adherence_rate: adherence_rate
            }
        });

    } catch (error) {
        console.error('❌ Error fetching medication history:', error);
        next(error);
    }
});

/**
 * @route   POST /api/medication-admin/bulk-log
 * @desc    Log multiple medications at once (for completing a visit)
 * @access  Private (Caregiver only)
 */
router.post('/bulk-log', authMiddleware, async (req, res, next) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const { visit_id, medications } = req.body;
        const caregiver_id = req.user.id;

        console.log('=================================');
        console.log('💊 Bulk Logging Medications for Visit:', visit_id);
        console.log('Number of medications:', medications?.length);
        console.log('=================================');

        if (!visit_id || !medications || !Array.isArray(medications)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid request: visit_id and medications array required'
            });
        }

        // Verify visit belongs to caregiver
        const [visit] = await connection.execute(
            `SELECT visit_id FROM visit 
             WHERE visit_id = ? AND caregiver_id = ?`,
            [visit_id, caregiver_id]
        );

        if (visit.length === 0) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: 'Unauthorized - This visit does not belong to you'
            });
        }

        let logged = 0;
        let updated = 0;

        // Process each medication
        for (const med of medications) {
            const { medication_id, administered, dose_given, notes } = med;

            // Check if exists
            const [existing] = await connection.execute(
                `SELECT id FROM medication_administration 
                 WHERE medication_id = ? AND visit_id = ?`,
                [medication_id, visit_id]
            );

            if (existing.length > 0) {
                // Update
                await connection.execute(
                    `UPDATE medication_administration 
                     SET administered = ?, dose_given = ?, notes = ?
                     WHERE medication_id = ? AND visit_id = ?`,
                    [administered, dose_given, notes, medication_id, visit_id]
                );
                updated++;
            } else {
                // Insert
                await connection.execute(
                    `INSERT INTO medication_administration 
                     (medication_id, visit_id, caregiver_id, administered, dose_given, notes)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [medication_id, visit_id, caregiver_id, administered, dose_given, notes]
                );
                logged++;
            }
        }

        await connection.commit();

        console.log('✅ Bulk log complete - New:', logged, 'Updated:', updated);

        res.json({
            success: true,
            message: 'Medications logged successfully',
            summary: {
                logged: logged,
                updated: updated,
                total: medications.length
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Error in bulk logging:', error);
        next(error);
    } finally {
        connection.release();
    }
});

module.exports = router;
