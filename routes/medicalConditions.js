const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const authMiddleware = require('../middleware/auth');

// Get medical conditions for a specific patient
router.get('/patient/:patientId', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT condition_id, condition_name, description, created_at
       FROM medical_conditions 
       WHERE care_recipient_id = ?`,
      [req.params.patientId]
    );
    
    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    next(error);
  }
});

// Get all medical conditions (optional)
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM medical_conditions');
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;