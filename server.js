const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { testConnection } = require('./config/database');

// Import middleware
const authMiddleware = require('./middleware/auth');
const { 
    isCaregiver, 
    isFamilyMember, 
    isCareRecipient,
    isCaregiverOrFamily 
} = require('./middleware/role');
const { 
    validateLogin,
    validateRegister,
    validateCareRecipient,
    validateRegisterCareRecipient,
    validateVisit,
    validateStartVisit,
    validateCompleteVisit,
    validateTask,
    validateFamilyLink,
    handleValidationErrors 
} = require('./middleware/validate');
const errorHandler = require('./middleware/error');

// Import route files
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const careRecipientRoutes = require('./routes/care-recipients');
const familyLinkRoutes = require('./routes/family-links');
const visitRoutes = require('./routes/visits');
const taskRoutes = require('./routes/tasks');
const alertRoutes = require('./routes/alerts');

dotenv.config();

const app = express();

// =====================================================
// Basic Middleware
// =====================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Test DB connection on startup
testConnection();

// =====================================================
// Public Routes (No Authentication Required)
// =====================================================

// Root route
app.get('/', (req, res) => {
    res.json({ 
        message: 'Carezone API is running', 
        status: 'OK',
        version: '1.0.0',
        roles: ['caregiver', 'family_member', 'care_recipient'],
        endpoints: {
            auth: '/api/auth',
            users: '/api/users',
            care_recipients: '/api/care-recipients',
            family_links: '/api/family-links',
            visits: '/api/visits',
            tasks: '/api/tasks',
            alerts: '/api/alerts'
        }
    });
});

// Simple test route
app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'API test successful', 
        timestamp: new Date(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// =====================================================
// API Routes
// =====================================================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/care-recipients', careRecipientRoutes);
app.use('/api/family-links', familyLinkRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/alerts', alertRoutes);

// =====================================================
// Database Test Route
// =====================================================
app.get('/api/test-users', async (req, res, next) => {
    try {
        const { pool } = require('./config/database');
        
        // Get counts from each table
        const [family] = await pool.execute('SELECT COUNT(*) as count FROM family_member');
        const [caregiver] = await pool.execute('SELECT COUNT(*) as count FROM caregiver');
        const [recipient] = await pool.execute('SELECT COUNT(*) as count FROM care_recipient');
        
        res.json({
            success: true,
            data: {
                family_members: family[0].count,
                caregivers: caregiver[0].count,
                care_recipients: recipient[0].count
            }
        });
    } catch (error) {
        next(error);
    }
});

// =====================================================
// 404 Handler
// =====================================================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Cannot find ${req.originalUrl} on this server`
    });
});

// =====================================================
// Error Handling Middleware
// =====================================================
app.use(errorHandler);

// =====================================================
// Start Server
// =====================================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log('=================================');
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('=================================');
});