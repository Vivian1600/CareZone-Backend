// routes/family-links.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { isFamilyMember } = require('../middleware/role');
const { validateFamilyLink, handleValidationErrors } = require('../middleware/validate');

/**
 * @route   POST /api/family-links
 * @desc    Create a family link (connect family member to care recipient)
 * @access  Private (Family members only)
 */
router.post('/', 
    authMiddleware, 
    isFamilyMember, 
    validateFamilyLink, 
    handleValidationErrors, 
    async (req, res, next) => {
        try {
            const { care_recipient_id, relationship, is_primary } = req.body;
            const family_member_id = req.user.id;

            // Check if link already exists
            const [existing] = await pool.execute(
                'SELECT * FROM family_links WHERE family_member_id = ? AND care_recipient_id = ?',
                [family_member_id, care_recipient_id]
            );

            if (existing.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'You are already linked to this care recipient'
                });
            }

            // If this is primary, unset any existing primary for this recipient
            if (is_primary) {
                await pool.execute(
                    'UPDATE family_links SET is_primary = false WHERE care_recipient_id = ?',
                    [care_recipient_id]
                );
            }

            // Create the link
            await pool.execute(
                `INSERT INTO family_links (family_member_id, care_recipient_id, relationship, is_primary) 
                 VALUES (?, ?, ?, ?)`,
                [family_member_id, care_recipient_id, relationship, is_primary || false]
            );

            res.status(201).json({
                success: true,
                message: 'Family link created successfully'
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @route   GET /api/family-links/my-recipients
 * @desc    Get all care recipients linked to current family member
 * @access  Private (Family members only)
 */
router.get('/my-recipients', 
    authMiddleware, 
    isFamilyMember, 
    async (req, res, next) => {
        try {
            const [recipients] = await pool.execute(
                `SELECT cr.*, fl.relationship, fl.is_primary,
                        cg.name as assigned_caregiver_name
                 FROM family_links fl
                 JOIN care_recipient cr ON fl.care_recipient_id = cr.care_recipient_id
                 LEFT JOIN caregiver cg ON cr.assigned_caregiver_id = cg.caregiver_id
                 WHERE fl.family_member_id = ?
                 ORDER BY fl.is_primary DESC, cr.name ASC`,
                [req.user.id]
            );

            res.json({
                success: true,
                count: recipients.length,
                data: recipients
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @route   GET /api/family-links/:care_recipient_id
 * @desc    Get all family members for a specific care recipient
 * @access  Private
 */
router.get('/:care_recipient_id', 
    authMiddleware, 
    async (req, res, next) => {
        try {
            const { care_recipient_id } = req.params;

            const [family] = await pool.execute(
                `SELECT fm.family_member_id as id, fm.name, fm.contact_no as phone, 
                        fm.email, fl.relationship, fl.is_primary
                 FROM family_links fl
                 JOIN family_member fm ON fl.family_member_id = fm.family_member_id
                 WHERE fl.care_recipient_id = ?
                 ORDER BY fl.is_primary DESC, fm.name ASC`,
                [care_recipient_id]
            );

            res.json({
                success: true,
                count: family.length,
                data: family
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @route   PUT /api/family-links/:id
 * @desc    Update a family link (relationship, primary status)
 * @access  Private (Family members only)
 */
router.put('/:id', 
    authMiddleware, 
    isFamilyMember, 
    async (req, res, next) => {
        try {
            const { id } = req.params;
            const { relationship, is_primary } = req.body;

            // Get the care_recipient_id for this link
            const [link] = await pool.execute(
                'SELECT care_recipient_id FROM family_links WHERE id = ? AND family_member_id = ?',
                [id, req.user.id]
            );

            if (link.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Family link not found'
                });
            }

            // If setting as primary, unset other primaries for this recipient
            if (is_primary) {
                await pool.execute(
                    'UPDATE family_links SET is_primary = false WHERE care_recipient_id = ?',
                    [link[0].care_recipient_id]
                );
            }

            // Update the link
            await pool.execute(
                `UPDATE family_links 
                 SET relationship = COALESCE(?, relationship),
                     is_primary = COALESCE(?, is_primary)
                 WHERE id = ? AND family_member_id = ?`,
                [relationship, is_primary, id, req.user.id]
            );

            res.json({
                success: true,
                message: 'Family link updated successfully'
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @route   DELETE /api/family-links/:id
 * @desc    Remove a family link
 * @access  Private (Family members only)
 */
router.delete('/:id', 
    authMiddleware, 
    isFamilyMember, 
    async (req, res, next) => {
        try {
            const { id } = req.params;

            const [result] = await pool.execute(
                'DELETE FROM family_links WHERE id = ? AND family_member_id = ?',
                [id, req.user.id]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Family link not found'
                });
            }

            res.json({
                success: true,
                message: 'Family link removed successfully'
            });
        } catch (error) {
            next(error);
        }
    }
);

module.exports = router;