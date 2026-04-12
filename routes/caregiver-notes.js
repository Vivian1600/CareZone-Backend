const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { isCaregiver } = require('../middleware/role');

// GET /api/caregiver-notes/:care_recipient_id
// Get all notes for a specific patient (by current caregiver)
router.get('/:care_recipient_id', authMiddleware, isCaregiver, async (req, res, next) => {
    try {
        const { care_recipient_id } = req.params;
        const caregiver_id = req.user.id;

        const [notes] = await pool.execute(
            `SELECT id, note, created_at 
             FROM caregiver_patient_notes 
             WHERE caregiver_id = ? AND care_recipient_id = ?
             ORDER BY created_at DESC`,
            [caregiver_id, care_recipient_id]
        );

        res.json({
            success: true,
            data: notes
        });
    } catch (error) {
        console.error('Error fetching caregiver notes:', error);
        next(error);
    }
});

// POST /api/caregiver-notes
// Add a new note about a patient
router.post('/', authMiddleware, isCaregiver, async (req, res, next) => {
    try {
        const { care_recipient_id, note } = req.body;
        const caregiver_id = req.user.id;

        if (!care_recipient_id || !note) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: care_recipient_id and note'
            });
        }

        const [result] = await pool.execute(
            `INSERT INTO caregiver_patient_notes (caregiver_id, care_recipient_id, note) 
             VALUES (?, ?, ?)`,
            [caregiver_id, care_recipient_id, note]
        );

        res.status(201).json({
            success: true,
            message: 'Note added successfully',
            note: {
                id: result.insertId,
                note: note,
                created_at: new Date()
            }
        });
    } catch (error) {
        console.error('Error adding caregiver note:', error);
        next(error);
    }
});

// DELETE /api/caregiver-notes/:id
// Delete a note
router.delete('/:id', authMiddleware, isCaregiver, async (req, res, next) => {
    try {
        const { id } = req.params;
        const caregiver_id = req.user.id;

        const [result] = await pool.execute(
            `DELETE FROM caregiver_patient_notes 
             WHERE id = ? AND caregiver_id = ?`,
            [id, caregiver_id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Note not found'
            });
        }

        res.json({
            success: true,
            message: 'Note deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting caregiver note:', error);
        next(error);
    }
});

module.exports = router;