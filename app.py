from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import joblib
import numpy as np
import os

app = Flask(__name__)
# Configure CORS
CORS(app, resources={
    r"/*": {
        "origins": ["https://diabetes-node-server.onrender.com", "https://diabetes-kwrz.onrender.com"],
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
        "supports_credentials": True
    }
})

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
        # Get data from JSON request
        data = request.get_json()
        
        if not data or 'data' not in data:
            return jsonify({
                'status': 'error',
                'message': 'Invalid request format. Expected JSON with "data" field containing features array.'
            }), 400

        # Get features from the data array
        features = data['data'][0]  # Get the first array of features
        
        if len(features) != 8:
            return jsonify({
                'status': 'error',
                'message': 'Invalid number of features. Expected 8 features.'
            }), 400

        # Convert features to float
        features = [float(x) for x in features]
        
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
    except ValueError as ve:
        return jsonify({
            'status': 'error',
            'message': f'Invalid feature values: {str(ve)}'
        }), 400
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=port) 