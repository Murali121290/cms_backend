import requests
import json

# Test the endpoint directly
url = "http://localhost:8000/api/v2/projects/4/analyze-files-for-stylesheet"
payload = {"file_ids": [1, 2, 3]}
headers = {"Content-Type": "application/json"}

try:
    response = requests.post(url, json=payload, headers=headers)
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.text}")
except Exception as e:
    print(f"Error: {e}")
