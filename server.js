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
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: true,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'none',
        domain: '.onrender.com' // Allow cookies across subdomains
    }
}));

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
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'templates', 'profile.html'));
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
            redirectUrl: 'https://diabetes-kwrz.onrender.com/dashboard'
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
});

// Login endpoint with rate limiting
app.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;

    try {
        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Find user
        const users = await getAllUsers();
        const user = users.find(user => user[2] === email); // email is at index 2

        if (!user) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user[3]); // password is at index 3
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        // Create session
        req.session.userId = user[0]; // id is at index 0
        res.json({ 
            success: true,
            redirectUrl: 'https://diabetes-kwrz.onrender.com/dashboard'
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

// Get user data endpoint
app.get('/api/user', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const users = await getAllUsers();
        const user = users.find(user => user[0] === req.session.userId.toString());

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            id: user[0],
            name: user[1],
            email: user[2],
            age: user[4],
            weight: user[5],
            height: user[6],
            bmi: user[7],
            profileImage: user[8] || '/default-avatar.png'
        });
    } catch (error) {
        console.error('Error fetching user data:', error);
        res.status(500).json({ error: 'Failed to fetch user data' });
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
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:10000';
        const response = await fetch(`${pythonServiceUrl}/predict`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(req.body)
        });

        if (!response.ok) {
            throw new Error('Python server error');
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Prediction error:', error);
        res.status(500).json({ 
            error: 'Prediction service unavailable',
            message: error.message 
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 