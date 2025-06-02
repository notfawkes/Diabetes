# Diabetes Prediction System

A full-stack web application for predicting diabetes risk based on various health parameters using machine learning.

## Features

- User authentication (login/register)
- Profile management with image upload
- Diabetes risk prediction using machine learning
- BMI calculation
- Responsive design
- Google Sheets integration for data storage
- Secure password hashing
- File upload with size and type validation

## Project Structure

```
├── server.js              # Main Express server
├── app.py                # Python Flask server for ML predictions
├── train_model.py        # Script for training the ML model
├── diabetes_model.joblib # Trained ML model
├── scaler.joblib        # Data scaler for preprocessing
├── diabetes.csv         # Training dataset
├── public/             # Static files
├── templates/          # HTML templates
└── requirements.txt    # Python dependencies
```
The Node.js server (`server.js`) handles user authentication, profile management, and serves static files and HTML templates. It communicates with the Python Flask server (`app.py`) to perform diabetes risk predictions.

## Setup

1. Clone the repository
2. Install Node.js dependencies:
   ```bash
   npm install
   ```
3. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Create a `.env` file with the following variables:
   ```
   GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account-email
   GOOGLE_PRIVATE_KEY=your-private-key
   GOOGLE_SHEETS_ID=your-sheets-id
   SESSION_SECRET=your-session-secret
   PORT=3000
   ```
5. Start the development servers:
   ```bash
   # Terminal 1 - Node.js server
   npm run dev
   
   # Terminal 2 - Python server
   python app.py
   ```

## Deployment on Render

1. Create a free account on [Render](https://render.com)
2. Create two new Web Services:
   - One for Node.js backend
   - One for Python ML server
3. Connect your GitHub repository
4. Configure the services:
   - Node.js service:
     - Build Command: `npm install`
     - Start Command: `npm start`
   - Python service:
     - Build Command: `pip install -r requirements.txt`
     - Start Command: `python app.py`
5. Add environment variables in Render dashboard
6. Deploy!

## Environment Variables

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: Google Cloud service account email
- `GOOGLE_PRIVATE_KEY`: Google Cloud private key
- `GOOGLE_SHEETS_ID`: Google Sheets ID for data storage
- `SESSION_SECRET`: Secret key for session management
- `PORT`: Server port (default: 3000)

## Technologies Used

### Backend
- Node.js
- Express.js
- Google Sheets API
- Python
- Flask
- Scikit-learn
- Joblib

### Machine Learning Model
- The system uses a **Random Forest Classifier** model for diabetes prediction.
- The model was trained on the **Pima Indians Diabetes Dataset** (`diabetes.csv`).

### Frontend
- HTML/CSS/JavaScript
- Bootstrap
- Multer for file uploads

### Data Storage
- Google Sheets
- Local file system (for profile images)

### Security
- bcrypt for password hashing
- express-session for session management
- Input validation and sanitization
- File upload restrictions

## API Documentation

### Authentication Endpoints
- POST `/register` - Register new user
- POST `/login` - User login
- GET `/logout` - User logout

### User Endpoints
- GET `/profile` - Get user profile
- POST `/profile/update` - Update user profile
- POST `/profile/upload` - Upload profile image

### Prediction Endpoints
- POST `/predict` - Get diabetes risk prediction

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request 