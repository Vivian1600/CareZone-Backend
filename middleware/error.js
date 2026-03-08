// middleware/error.js

/**
 * Central Error Handling Middleware
 * Catches all errors and formats consistent responses
 */
const errorHandler = (err, req, res, next) => {
    // Log error for debugging
    console.error('❌ Error:', err);
    
    let error = { ...err };
    error.message = err.message;
    
    // =====================================================
    // MySQL/Database Errors
    // =====================================================
    
    // MySQL duplicate entry error (ER_DUP_ENTRY)
    if (err.code === 'ER_DUP_ENTRY') {
        // Extract the duplicate value from error message
        const match = err.message.match(/Duplicate entry '(.+?)' for key '(.+?)'/);
        const value = match ? match[1] : 'value';
        const field = match ? match[2] : 'field';
        
        return res.status(400).json({
            success: false,
            message: `${field} with value '${value}' already exists`,
            error: 'DUPLICATE_ENTRY'
        });
    }
    
    // MySQL foreign key constraint error
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({
            success: false,
            message: 'Referenced record does not exist',
            error: 'FOREIGN_KEY_CONSTRAINT'
        });
    }
    
    // MySQL cannot add/update child row
    if (err.code === 'ER_NO_REFERENCED_ROW') {
        return res.status(400).json({
            success: false,
            message: 'Invalid reference: The related record does not exist',
            error: 'INVALID_REFERENCE'
        });
    }
    
    // MySQL data too long
    if (err.code === 'ER_DATA_TOO_LONG') {
        return res.status(400).json({
            success: false,
            message: 'Data provided exceeds maximum length',
            error: 'DATA_TOO_LONG'
        });
    }
    
    // MySQL invalid data type
    if (err.code === 'ER_TRUNCATED_WRONG_VALUE') {
        return res.status(400).json({
            success: false,
            message: 'Invalid data type provided',
            error: 'INVALID_DATA_TYPE'
        });
    }
    
    // MySQL connection errors
    if (err.code === 'ECONNREFUSED') {
        return res.status(503).json({
            success: false,
            message: 'Database connection failed',
            error: 'DATABASE_CONNECTION_ERROR'
        });
    }
    
    // =====================================================
    // JWT Authentication Errors
    // =====================================================
    
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            message: 'Invalid token',
            error: 'INVALID_TOKEN'
        });
    }
    
    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            success: false,
            message: 'Token expired',
            error: 'TOKEN_EXPIRED'
        });
    }
    
    // =====================================================
    // Validation Errors (from express-validator)
    // =====================================================
    
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: err.errors
        });
    }
    
    // =====================================================
    // File Upload Errors
    // =====================================================
    
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
            success: false,
            message: 'File too large',
            error: 'FILE_TOO_LARGE'
        });
    }
    
    if (err.code === 'LIMIT_FILE_TYPE') {
        return res.status(400).json({
            success: false,
            message: 'Invalid file type',
            error: 'INVALID_FILE_TYPE'
        });
    }
    
    // =====================================================
    // Default Server Error
    // =====================================================
    
    // Set default status
    const statusCode = err.statusCode || 500;
    
    res.status(statusCode).json({
        success: false,
        message: err.message || 'Server Error',
        error: err.code || 'INTERNAL_SERVER_ERROR',
        // Include stack trace only in development
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

module.exports = errorHandler;