from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import joblib
import numpy as np
import os

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Load the model and scaler
model = joblib.load('diabetes_model.joblib')
scaler = joblib.load('scaler.joblib')

port = int(os.environ.get('PORT', 10000))

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/health')
def health_check():
    return jsonify({"status": "healthy"}), 200

@app.route('/predict', methods=['POST'])
def predict():
    try:
        # Get values from the form
        features = [
            float(request.form['pregnancies']),
            float(request.form['glucose']),
            float(request.form['bloodPressure']),
            float(request.form['skinThickness']),
            float(request.form['insulin']),
            float(request.form['bmi']),
            float(request.form['diabetesPedigree']),
            float(request.form['age'])
        ]
        
        # Scale the features
        features_scaled = scaler.transform([features])
        
        # Make prediction
        prediction = model.predict(features_scaled)[0]
        probability = model.predict_proba(features_scaled)[0][1]
        
        return jsonify({
            'prediction': int(prediction),
            'probability': float(probability),
            'status': 'success'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=port) 