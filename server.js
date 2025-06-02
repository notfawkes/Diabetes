const express = require('express');
const { google } = require('googleapis');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
const multer = require('multer');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const fetch = require('node-fetch');
const cookieParser = require('cookie-parser');

// Load environment variables
dotenv.config();

const app = express();

// Rate limiting configuration
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    message: { error: 'Too many login attempts, please try again after 15 minutes' }
});

const predictLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 attempts per hour
    message: { error: 'Too many prediction requests, please try again later' }
});

// Middleware
app.use(cors({
    origin: ['https://diabetes-kwrz.onrender.com', 'https://diabetes-node-server.onrender.com'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Set-Cookie']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(cookieParser());

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: true,
    saveUninitialized: true,
    cookie: {
        secure: true,
        httpOnly: true,
        sameSite: 'none',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Middleware to handle cross-domain cookies
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin === 'https://diabetes-kwrz.onrender.com') {
        if (req.session.userId) {
            res.cookie('userId', req.session.userId, {
                secure: true,
                httpOnly: true,
                sameSite: 'none',
                maxAge: 24 * 60 * 60 * 1000,
                domain: 'diabetes-node-server.onrender.com'
            });
        }
    }
    next();
});

// Google Sheets setup
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        // Create uploads directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Create unique filename with original extension
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        // Accept only image files
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
            return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
    }
});

// Initialize Google Sheet
async function initializeSheet() {
    try {
        // Check if headers exist
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Users!A1:H1',
        });

        if (!response.data.values || response.data.values.length === 0) {
            // Create headers if they don't exist
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: 'Users!A1:H1',
                valueInputOption: 'RAW',
                resource: {
                    values: [['id', 'name', 'email', 'password', 'age', 'weight', 'height', 'bmi']]
                }
            });
        }
        console.log('Google Sheet initialized');
    } catch (error) {
        console.error('Error initializing Google Sheet:', error);
    }
}

// Initialize sheet on startup
initializeSheet();

// Helper function to get all users
async function getAllUsers() {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Users!A2:H',
        });
        return response.data.values || [];
    } catch (error) {
        console.error('Error fetching users:', error);
        return [];
    }
}

// Helper function to add a new user
async function addUser(userData) {
    try {
        const users = await getAllUsers();
        const newId = users.length + 1;
        
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Users!A:H',
            valueInputOption: 'RAW',
            resource: {
                values: [[
                    newId,
                    userData.name,
                    userData.email,
                    userData.password,
                    userData.age,
                    userData.weight,
                    userData.height,
                    userData.bmi
                ]]
            }
        });
        return newId;
    } catch (error) {
        console.error('Error adding user:', error);
        throw error;
    }
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'landing.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'register.html'));
});

app.get('/dashboard', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

app.get('/profile', (req, res) => {
    try {
        console.log('Profile request - Headers:', req.headers);
        console.log('Profile request - Session:', req.session);
        console.log('Profile request - Cookies:', req.cookies);
        
        const userId = req.session.userId || req.cookies?.userId;
        if (!userId) {
            console.log('No user ID in session or cookies for profile');
            return res.redirect('https://diabetes-node-server.onrender.com/login');
        }

        // Set the userId cookie if it's not already set
        if (!req.cookies?.userId && req.session.userId) {
            res.cookie('userId', req.session.userId, {
                secure: true,
                httpOnly: true,
                sameSite: 'none',
                maxAge: 24 * 60 * 60 * 1000,
                domain: 'diabetes-node-server.onrender.com'
            });
        }

        res.sendFile(path.join(__dirname, 'templates', 'profile.html'));
    } catch (error) {
        console.error('Profile route error:', error);
        res.redirect('https://diabetes-node-server.onrender.com/login');
    }
});

// Registration endpoint
app.post('/register', async (req, res) => {
    const { name, email, password, age, weight, height } = req.body;
    
    try {
        // Validate required fields
        if (!name || !email || !password || !age || !weight || !height) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check if user already exists
        const users = await getAllUsers();
        const existingUser = users.find(user => user[2] === email); // email is at index 2

        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Calculate BMI
        const heightInMeters = height / 100;
        const bmi = weight / (heightInMeters * heightInMeters);

        // Add new user
        const userId = await addUser({
            name,
            email,
            password: hashedPassword,
            age,
            weight,
            height,
            bmi
        });

        // Create session
        req.session.userId = userId;
        res.json({ 
            success: true,
            redirectUrl: 'https://diabetes-kwrz.onrender.com/'
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
});

// Login endpoint with rate limiting
app.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    console.log('Login attempt for email:', email);

    try {
        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Find user
        const users = await getAllUsers();
        const user = users.find(user => user[2] === email); // email is at index 2

        if (!user) {
            console.log('User not found');
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user[3]); // password is at index 3
        if (!validPassword) {
            console.log('Invalid password');
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        // Create session
        req.session.userId = user[0]; // id is at index 0
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ error: 'Login failed. Please try again.' });
            }
            console.log('Session created with userId:', user[0]);
            
            // Set cookies for both domains
            res.cookie('userId', user[0], {
                secure: true,
                httpOnly: true,
                sameSite: 'none',
                maxAge: 24 * 60 * 60 * 1000,
                domain: 'diabetes-node-server.onrender.com'
            });

            res.cookie('userId', user[0], {
                secure: true,
                httpOnly: true,
                sameSite: 'none',
                maxAge: 24 * 60 * 60 * 1000,
                domain: 'diabetes-kwrz.onrender.com'
            });

            res.json({ 
                success: true,
                redirectUrl: 'https://diabetes-kwrz.onrender.com/'
            });
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

// Logout endpoint
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Add a session check endpoint
app.get('/api/check-session', (req, res) => {
    try {
        console.log('Session check - Headers:', req.headers);
        console.log('Session check - Session:', req.session);
        console.log('Session check - Cookies:', req.cookies);
        
        // Check both session and cookies
        const sessionUserId = req.session.userId;
        const cookieUserId = req.cookies?.userId;
        
        console.log('Session userId:', sessionUserId);
        console.log('Cookie userId:', cookieUserId);
        
        if (sessionUserId || cookieUserId) {
            // If we have a cookie but no session, restore the session
            if (!sessionUserId && cookieUserId) {
                req.session.userId = cookieUserId;
                req.session.save((err) => {
                    if (err) {
                        console.error('Error saving session:', err);
                    }
                });
            }
            
            res.json({ 
                authenticated: true, 
                userId: sessionUserId || cookieUserId
            });
        } else {
            res.json({ authenticated: false });
        }
    } catch (error) {
        console.error('Session check error:', error);
        res.status(500).json({ 
            error: 'Session check failed',
            message: error.message
        });
    }
});

// Get user data endpoint
app.get('/api/user', async (req, res) => {
    try {
        console.log('User data request - Headers:', req.headers);
        console.log('User data request - Session:', req.session);
        console.log('User data request - Cookies:', req.cookies);
        
        const userId = req.session.userId || req.cookies?.userId;
        if (!userId) {
            console.log('No user ID in session or cookies');
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const users = await getAllUsers();
        console.log('All users:', users);
        const user = users.find(user => user[0] === userId.toString());
        console.log('Found user:', user);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = {
            id: user[0],
            name: user[1],
            email: user[2],
            age: parseInt(user[4]) || 0,
            weight: parseFloat(user[5]) || 0,
            height: parseFloat(user[6]) || 0,
            bmi: parseFloat(user[7]) || 0,
            profileImage: user[8] || '/default-avatar.png'
        };

        console.log('Sending user data:', userData);
        res.json(userData);
    } catch (error) {
        console.error('Error fetching user data:', error);
        res.status(500).json({ 
            error: 'Failed to fetch user data',
            message: error.message
        });
    }
});

// Profile image upload endpoint
app.post('/api/upload-profile-image', upload.single('profileImage'), async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Get the file path relative to public directory
        const imageUrl = '/uploads/' + req.file.filename;

        // Update user's profile image in the database
        const users = await getAllUsers();
        const userIndex = users.findIndex(user => user[0] === req.session.userId.toString());
        
        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update the profile image URL in the spreadsheet
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `Users!I${userIndex + 2}`, // Column I for profile image
            valueInputOption: 'RAW',
            resource: {
                values: [[imageUrl]]
            }
        });

        res.json({ 
            success: true,
            imageUrl: imageUrl
        });
    } catch (error) {
        console.error('Error uploading profile image:', error);
        res.status(500).json({ error: 'Failed to upload image' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

// Prediction endpoint with rate limiting
app.post('/predict', predictLimiter, async (req, res) => {
    try {
        console.log('Prediction request - Headers:', req.headers);
        console.log('Prediction request - Session:', req.session);
        console.log('Prediction request - Cookies:', req.cookies);
        
        const userId = req.session.userId || req.cookies?.userId;
        if (!userId) {
            console.log('No user ID in session or cookies for prediction');
            return res.status(401).json({ error: 'Not authenticated' });
        }

        // Use the correct Python service URL
        const pythonServiceUrl = 'https://diabetes-kwrz.onrender.com';
        console.log('Sending prediction request to:', pythonServiceUrl);
        
        const response = await fetch(`${pythonServiceUrl}/predict`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify(req.body),
            credentials: 'include'
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Python service error:', errorData);
            throw new Error(errorData.message || `Python server error: ${response.status}`);
        }

        const data = await response.json();
        console.log('Prediction response:', data);
        
        // Set the userId cookie if it's not already set
        if (!req.cookies?.userId && req.session.userId) {
            res.cookie('userId', req.session.userId, {
                secure: true,
                httpOnly: true,
                sameSite: 'none',
                maxAge: 24 * 60 * 60 * 1000,
                domain: 'diabetes-node-server.onrender.com'
            });
        }
        
        res.json({
            prediction: data.prediction,
            probability: data.probability
        });
    } catch (error) {
        console.error('Prediction error:', error);
        res.status(500).json({ 
            error: 'Prediction service unavailable',
            message: error.message || 'Failed to connect to prediction service'
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({ 
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
    });
});

// 404 handler
app.use((req, res) => {
    console.log('404 Not Found:', req.method, req.url);
    res.status(404).json({ 
        error: 'Not Found',
        message: 'The requested resource was not found'
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Environment:', process.env.NODE_ENV || 'development');
}); 