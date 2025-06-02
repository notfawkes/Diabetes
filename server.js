const express = require('express');
const { google } = require('googleapis');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
const multer = require('multer');
const fs = require('fs');

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production' }
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
        res.json({ success: true });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
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
        res.json({ success: true });
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

// Prediction endpoint
app.post('/predict', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const {
            pregnancies,
            glucose,
            bloodPressure,
            skinThickness,
            insulin,
            bmi,
            diabetesPedigree,
            age
        } = req.body;

        // Validate required fields
        if (!glucose || !bloodPressure || !skinThickness || !insulin || !bmi || !diabetesPedigree || !age) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Convert string values to numbers
        const features = {
            pregnancies: parseInt(pregnancies) || 0,
            glucose: parseFloat(glucose),
            bloodPressure: parseFloat(bloodPressure),
            skinThickness: parseFloat(skinThickness),
            insulin: parseFloat(insulin),
            bmi: parseFloat(bmi),
            diabetesPedigree: parseFloat(diabetesPedigree),
            age: parseInt(age)
        };

        // Simple risk calculation based on medical guidelines
        let riskScore = 0;

        // Glucose level (70-140 mg/dL is normal)
        if (features.glucose > 140) riskScore += 2;
        else if (features.glucose > 100) riskScore += 1;

        // Blood Pressure (normal: 90-120/60-80)
        if (features.bloodPressure > 140) riskScore += 2;
        else if (features.bloodPressure > 120) riskScore += 1;

        // BMI (normal: 18.5-24.9)
        if (features.bmi > 30) riskScore += 2;
        else if (features.bmi > 25) riskScore += 1;

        // Age (risk increases with age)
        if (features.age > 45) riskScore += 2;
        else if (features.age > 35) riskScore += 1;

        // Insulin (normal: 3-25 μU/mL)
        if (features.insulin > 25) riskScore += 1;

        // Diabetes Pedigree Function (higher values indicate higher risk)
        if (features.diabetesPedigree > 1.5) riskScore += 2;
        else if (features.diabetesPedigree > 0.8) riskScore += 1;

        // Calculate probability (0-1)
        const probability = Math.min(riskScore / 10, 1);

        // Determine prediction (threshold at 0.5)
        const prediction = probability > 0.5;

        res.json({
            status: 'success',
            prediction,
            probability,
            riskScore,
            features
        });
    } catch (error) {
        console.error('Prediction error:', error);
        res.status(500).json({ error: 'Prediction failed. Please try again.' });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 