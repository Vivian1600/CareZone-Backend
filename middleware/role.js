// middleware/role.js

/**
 * Role-Based Authorization Middleware
 * Restricts access based on user roles
 * @param {...string} roles - Allowed roles
 */
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                success: false,
                message: 'Authentication required' 
            });
        }
        
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ 
                success: false,
                message: `Access denied. Required role: ${roles.join(' or ')}` 
            });
        }
        
        next();
    };
};

// Role checkers (coordinator removed)
const isCaregiver = authorize('caregiver');
const isFamilyMember = authorize('family_member');
const isCareRecipient = authorize('care_recipient');

// Combined role checks
const isCaregiverOrFamily = authorize('caregiver', 'family_member');
const isFamilyOrRecipient = authorize('family_member', 'care_recipient');

module.exports = {
    authorize,
    isCaregiver,
    isFamilyMember,
    isCareRecipient,
    isCaregiverOrFamily,
    isFamilyOrRecipient
};
