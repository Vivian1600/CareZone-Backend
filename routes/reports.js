const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { isFamilyMember } = require('../middleware/role');

/**
 * @route   GET /api/reports/weekly/:recipientId
 * @desc    Get weekly report for a care recipient (and save it)
 * @access  Private (Family members only)
 */
router.get('/weekly/:recipientId', authMiddleware, isFamilyMember, async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { recipientId } = req.params;
        const { week_start } = req.query;

        // Verify family member is linked to this recipient
        const [linkCheck] = await connection.execute(
            `SELECT * FROM family_links 
             WHERE family_member_id = ? AND care_recipient_id = ?`,
            [req.user.id, recipientId]
        );

        if (linkCheck.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to view reports for this care recipient'
            });
        }

        // Determine week range
        let startDate, endDate;
        if (week_start) {
            startDate = new Date(week_start);
        } else {
            startDate = new Date();
            startDate.setDate(startDate.getDate() - startDate.getDay() + 1);
        }
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 6);

        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];

        console.log('📊 Generating weekly report for recipient:', recipientId);
        console.log('📅 Week:', startDateStr, 'to', endDateStr);

        // Check if report already exists
        const [existingReport] = await connection.execute(
            `SELECT report_id, report_data FROM weekly_reports 
             WHERE family_member_id = ? AND care_recipient_id = ? 
               AND week_start = ? AND week_end = ?`,
            [req.user.id, recipientId, startDateStr, endDateStr]
        );

        if (existingReport.length > 0) {
            console.log('✅ Returning existing report from database');
            // Parse safely
            let reportData;
            try {
                reportData = typeof existingReport[0].report_data === 'string' 
                    ? JSON.parse(existingReport[0].report_data) 
                    : existingReport[0].report_data;
            } catch (parseError) {
                console.error('Error parsing report data:', parseError);
                reportData = { error: 'Invalid report data' };
            }
            
            return res.json({
                success: true,
                report: reportData,
                report_id: existingReport[0].report_id,
                from_cache: true
            });
        }

        // Get recipient basic info
        const [recipient] = await connection.execute(
            `SELECT name, date_of_birth, gender 
             FROM care_recipient WHERE care_recipient_id = ?`,
            [recipientId]
        );

        // Get visits for the week
        const [visits] = await connection.execute(
            `SELECT v.*
             FROM visit v
             WHERE v.care_recipient_id = ?
               AND DATE(v.scheduled_time) BETWEEN ? AND ?
             ORDER BY v.scheduled_time`,
            [recipientId, startDateStr, endDateStr]
        );

        // Get tasks completed during the week
        const [tasks] = await connection.execute(
            `SELECT t.*, v.scheduled_time
             FROM task t
             JOIN visit v ON t.visit_id = v.visit_id
             WHERE v.care_recipient_id = ?
               AND DATE(t.completed_at) BETWEEN ? AND ?
               AND t.status = 'completed'
             ORDER BY t.completed_at`,
            [recipientId, startDateStr, endDateStr]
        );

        // Get medications
        const [medications] = await connection.execute(
            `SELECT * FROM medication 
             WHERE care_recipient_id = ? AND is_active = 1`,
            [recipientId]
        );

        // Calculate medication adherence
        const totalMedications = medications.length;
        const daysInWeek = 7;
        const expectedDoses = totalMedications * daysInWeek;

        // Count medication tasks completed
        const medicationTasks = tasks.filter(t => 
            t.description && (
                t.description.toLowerCase().includes('medication') || 
                t.description.toLowerCase().includes('insulin') ||
                t.description.toLowerCase().includes('administer')
            )
        );

        // Get well-being notes from visit notes
        const wellBeingNotes = visits
            .filter(v => v.notes && v.notes.trim() !== '')
            .map(v => ({
                date: v.scheduled_time,
                note: v.notes,
                caregiver: 'Caregiver'
            }));

        // Get daily summaries
        const dailySummaries = [];
        for (let i = 0; i <= 6; i++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(startDate.getDate() + i);
            const dateStr = currentDate.toISOString().split('T')[0];
            
            const dayVisits = visits.filter(v => 
                new Date(v.scheduled_time).toISOString().split('T')[0] === dateStr
            );
            
            const dayTasks = tasks.filter(t => 
                new Date(t.completed_at).toISOString().split('T')[0] === dateStr
            );

            dailySummaries.push({
                date: dateStr,
                visit_count: dayVisits.length,
                tasks_completed: dayTasks.length
            });
        }

        // Compile report as plain object (no JSON.stringify yet)
        const report = {
            recipient: {
                name: recipient[0]?.name || 'Unknown',
                date_of_birth: recipient[0]?.date_of_birth,
                gender: recipient[0]?.gender
            },
            week: {
                start: startDateStr,
                end: endDateStr
            },
            summary: {
                total_visits: visits.length,
                completed_visits: visits.filter(v => v.status === 'completed').length,
                scheduled_visits: visits.filter(v => v.status === 'scheduled').length,
                in_progress_visits: visits.filter(v => v.status === 'in_progress').length,
                missed_visits: visits.filter(v => v.status === 'missed').length,
                total_tasks: tasks.length,
                medication_tasks: medicationTasks.length,
                expected_medication_doses: expectedDoses,
                medication_adherence_rate: expectedDoses > 0 
                    ? Math.round((medicationTasks.length / expectedDoses) * 100) 
                    : null
            },
            visits: visits.map(v => ({
                id: v.visit_id,
                date: v.scheduled_time,
                status: v.status,
                notes: v.notes,
                duration: v.actual_end_time && v.actual_start_time 
                    ? Math.round((new Date(v.actual_end_time) - new Date(v.actual_start_time)) / 60000) 
                    : null
            })),
            tasks: tasks.map(t => ({
                id: t.task_id,
                date: t.completed_at,
                description: t.description,
                notes: t.notes,
                visit_time: t.scheduled_time
            })),
            medications: medications.map(m => ({
                id: m.medication_id,
                name: m.name,
                dosage: m.dosage,
                frequency: m.frequency,
                condition: m.medical_condition
            })),
            well_being_notes: wellBeingNotes,
            daily_summaries: dailySummaries,
            generated_at: new Date().toISOString()
        };

        // Save report to database - stringify only when saving
        const reportDataString = JSON.stringify(report);
        await connection.execute(
            `INSERT INTO weekly_reports 
             (family_member_id, care_recipient_id, week_start, week_end, report_data) 
             VALUES (?, ?, ?, ?, ?)`,
            [req.user.id, recipientId, startDateStr, endDateStr, reportDataString]
        );

        console.log('✅ Report generated and saved successfully');

        res.json({
            success: true,
            report: report,
            from_cache: false
        });

    } catch (error) {
        console.error('❌ Error generating report:', error);
        next(error);
    } finally {
        connection.release();
    }
});

/**
 * @route   GET /api/reports/history/:recipientId
 * @desc    Get all past reports for a care recipient
 * @access  Private (Family members only)
 */
router.get('/history/:recipientId', authMiddleware, isFamilyMember, async (req, res, next) => {
    try {
        const { recipientId } = req.params;

        const [linkCheck] = await pool.execute(
            `SELECT * FROM family_links 
             WHERE family_member_id = ? AND care_recipient_id = ?`,
            [req.user.id, recipientId]
        );

        if (linkCheck.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to view reports for this care recipient'
            });
        }

        const [reports] = await pool.execute(
            `SELECT report_id, week_start, week_end, generated_at
             FROM weekly_reports 
             WHERE family_member_id = ? AND care_recipient_id = ?
             ORDER BY week_start DESC`,
            [req.user.id, recipientId]
        );

        res.json({
            success: true,
            reports: reports.map(r => ({
                report_id: r.report_id,
                week_start: r.week_start ? new Date(r.week_start).toISOString().split('T')[0] : null,
                week_end: r.week_end ? new Date(r.week_end).toISOString().split('T')[0] : null,
                generated_at: r.generated_at
            }))
        });

    } catch (error) {
        console.error('❌ Error fetching report history:', error);
        next(error);
    }
});

/**
 * @route   GET /api/reports/:reportId
 * @desc    Get a specific report by ID
 * @access  Private (Family members only)
 */
router.get('/:reportId', authMiddleware, isFamilyMember, async (req, res, next) => {
    try {
        const { reportId } = req.params;

        const [reports] = await pool.execute(
            `SELECT * FROM weekly_reports 
             WHERE report_id = ? AND family_member_id = ?`,
            [reportId, req.user.id]
        );

        if (reports.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Report not found'
            });
        }

        // Parse the report_data safely
        let reportData;
        try {
            reportData = typeof reports[0].report_data === 'string' 
                ? JSON.parse(reports[0].report_data) 
                : reports[0].report_data;
        } catch (parseError) {
            console.error('Error parsing report data:', parseError);
            reportData = { error: 'Invalid report data' };
        }

        res.json({
            success: true,
            report: reportData,
            report_id: reports[0].report_id
        });

    } catch (error) {
        console.error('❌ Error fetching report:', error);
        next(error);
    }
});

module.exports = router;