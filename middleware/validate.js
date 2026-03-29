// middleware/validate.js
const { body, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            success: false,
            errors: errors.array().map(err => ({
                field: err.path,
                message: err.msg
            }))
        });
    }
    next();
};

// Register validation - NO registration_no
const validateRegister = [
    body('name')
        .notEmpty().withMessage('Name is required')
        .isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
    
    body('email')
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Please provide a valid email')
        .normalizeEmail(),
    
    body('phone')
        .notEmpty().withMessage('Phone number is required')
        .matches(/^(07|01)\d{8}$/).withMessage('Phone number must be a valid Kenyan number (e.g., 0712345678)'),
    
    body('password')
        .notEmpty().withMessage('Password is required')
        .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    
    body('role')
        .notEmpty().withMessage('Role is required')
        .isIn(['caregiver', 'family_member'])
        .withMessage('Invalid role specified. Must be caregiver or family_member'),
    
    body('address').optional().isString(),
    body('type').optional().isString()
];

// Login validation
const validateLogin = [
    body('email')
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Please provide a valid email')
        .normalizeEmail(),
    
    body('password')
        .notEmpty().withMessage('Password is required')
];

// Care recipient registration validation
const validateRegisterCareRecipient = [
    body('name')
        .notEmpty().withMessage('Care recipient name is required'),
    
    body('date_of_birth')
        .notEmpty().withMessage('Date of birth is required')
        .isDate().withMessage('Valid date required (YYYY-MM-DD)'),
    
    body('gender')
        .notEmpty().withMessage('Gender is required')
        .isIn(['Male', 'Female', 'Other']),
    
    body('relationship')
        .notEmpty().withMessage('Your relationship to care recipient is required')
        .isIn(['son', 'daughter', 'father', 'mother', 'spouse', 'brother', 'sister', 'grandparent', 'other']),
    
    body('emergency_contact_name')
        .notEmpty().withMessage('Emergency contact name is required'),
    
    body('emergency_contact_phone')
        .notEmpty().withMessage('Emergency contact phone is required')
        .matches(/^(07|01)\d{8}$/),
    
    body('care_level')
        .optional()
        .isIn(['Low', 'Medium', 'High'])
];

// =====================================================
// ADD THIS: Family Link Validation
// =====================================================
const validateFamilyLink = [
    body('care_recipient_id')
        .notEmpty().withMessage('Care recipient ID is required')
        .isInt().withMessage('Care recipient ID must be a number'),
    
    body('relationship')
        .notEmpty().withMessage('Relationship is required')
        .isIn(['son', 'daughter', 'father', 'mother', 'spouse', 'brother', 'sister', 'grandparent', 'other'])
        .withMessage('Invalid relationship specified'),
    
    body('is_primary')
        .optional()
        .isBoolean().withMessage('is_primary must be true or false')
];

// =====================================================
// Visit Validation
// =====================================================
const validateVisit = [
    body('care_recipient_id')
        .notEmpty().withMessage('Care recipient ID is required')
        .isInt(),
    
    body('scheduled_date')
        .notEmpty().withMessage('Scheduled date is required')
        .isDate(),
    
    body('scheduled_time')
        .optional()
        .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
];

const validateStartVisit = [
    body('latitude')
        .notEmpty().withMessage('Location required')
        .isFloat({ min: -90, max: 90 }),
    
    body('longitude')
        .notEmpty().withMessage('Location required')
        .isFloat({ min: -180, max: 180 })
];

// In middleware/validate.js or wherever validateCompleteVisit is defined
const validateCompleteVisit = [
    body('latitude').optional().isFloat().withMessage('Latitude must be a number'),
    body('longitude').optional().isFloat().withMessage('Longitude must be a number'),
    body('notes').optional().isString().withMessage('Notes must be text'),
    body('tasks').optional().isArray().withMessage('Tasks must be an array')
];

// =====================================================
// Task Validation
// =====================================================
const validateTask = [
    body('description')
        .notEmpty().withMessage('Task description required')
        .isLength({ max: 255 }),
    
    body('category')
        .optional()
        .isIn(['medication', 'meal', 'hygiene', 'checkup', 'other']),
    
    body('scheduled_time')
        .optional()
        .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
];

// =====================================================
// Export all validators
// =====================================================
module.exports = {
    // User validators
    validateRegister,
    validateLogin,
    
    // Care recipient validators
    validateRegisterCareRecipient,
    
    // Family link validators
    validateFamilyLink,  // This was missing!
    
    // Visit validators
    validateVisit,
    validateStartVisit,
    validateCompleteVisit,
    
    // Task validators
    validateTask,
    
    // Error handler
    handleValidationErrors
};