# API Calls Guide — CMS Backend & WMS Integration

---

## **1. WHAT IS AN API CALL?**

An **API Call** is a request from one application to another to get data or perform an action.

**Structure:**
```
METHOD  URL/ENDPOINT  HEADERS  BODY
  │         │           │        │
  ▼         ▼           ▼        ▼
POST  /api/v1/files  Content-Type  {"key": "value"}
```

### **HTTP Methods:**
| Method | Purpose | Example |
|--------|---------|---------|
| **GET** | Fetch data | `GET /jobs` — list all jobs |
| **POST** | Create/send data | `POST /jobs` — create new job |
| **PUT** | Update data | `PUT /jobs/1` — update job |
| **DELETE** | Delete data | `DELETE /jobs/1` — remove job |

---

## **2. YOUR SYSTEM'S API LAYERS**

```
User/Browser
    │
    ▼
┌─────────────────────────┐
│  Frontend (React UI)    │  ◄─ Makes API calls to backend
└─────────────────────────┘
    │
    ▼  (HTTP requests)
┌─────────────────────────┐
│  FastAPI Backend        │  ◄─ Processes requests, calls services
│  /api/v1/...            │
│  /api/v2/...            │
└─────────────────────────┘
    │
    ▼  (Database calls)
┌─────────────────────────┐
│  PostgreSQL Database    │  ◄─ Stores all data
└─────────────────────────┘
```

---

## **3. AUTHENTICATION (How to Log In)**

Before making API calls, you need a **token** or **session**.

### **Option A: Bearer Token (API v1)**

**Step 1: Login to get token**
```bash
curl -X POST http://localhost:8000/api/v1/users/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=password123"
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer"
}
```

**Step 2: Use token in future requests**
```bash
curl -X GET http://localhost:8000/api/v1/files \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### **Option B: Cookie Session (API v2)**

**Step 1: Login**
```bash
curl -X POST http://localhost:8000/api/v2/session/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "password123"
  }' \
  -c cookies.txt  # Save cookies to file
```

**Response:**
```json
{
  "status": "ok",
  "session": {
    "authenticated": true,
    "expires_at": "2026-05-25T10:30:00Z"
  },
  "viewer": {
    "id": 1,
    "username": "admin",
    "roles": ["admin"]
  }
}
```

**Step 2: Use cookies in future requests**
```bash
curl -X GET http://localhost:8000/api/v2/projects \
  -b cookies.txt  # Use saved cookies
```

---

## **4. MAIN API ENDPOINTS (WMS Relevant)**

### **A. Project Management**

**Create a Project**
```bash
POST /api/v2/projects/bootstrap
Content-Type: multipart/form-data

Parameters:
  code: "PPH"
  title: "PPH Book Project"
  client_name: "S4Carlisle"
  xml_standard: "BITS"
  chapter_count: 5
  files: (optional .docx files)
```

**Response:**
```json
{
  "project_id": 42,
  "project_code": "PPH",
  "chapter_count": 5,
  "created_at": "2026-05-25T09:00:00Z"
}
```

### **B. File Upload & Management**

**Upload a File**
```bash
POST /api/v1/files/?project_id=42
Content-Type: multipart/form-data

Body:
  file: <binary .docx file>
```

**Response:**
```json
{
  "file_id": 123,
  "filename": "chapter01.docx",
  "project_id": 42,
  "path": "/uploads/PPH/ch1/Manuscript/chapter01.docx",
  "size_bytes": 512000,
  "uploaded_at": "2026-05-25T09:15:00Z"
}
```

**Get File Details**
```bash
GET /api/v1/files/123
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": 123,
  "filename": "chapter01.docx",
  "size": 512000,
  "status": "ready",
  "versions": [
    {
      "version_id": "v1_123",
      "timestamp": "2026-05-25T09:15:00Z"
    }
  ]
}
```

### **C. Processing (Trigger Jobs)**

**Trigger Reference Validation**
```bash
POST /api/v1/processing/files/123/process/reference_validation
Authorization: Bearer <token>
Content-Type: application/json

Body: {}
```

**Response:**
```json
{
  "job_id": "job_abc123def",
  "file_id": 123,
  "process_type": "reference_validation",
  "status": "queued",
  "started_at": "2026-05-25T09:20:00Z"
}
```

**Check Processing Status**
```bash
GET /api/v1/processing/files/123/structuring_status
Authorization: Bearer <token>
```

**Response:**
```json
{
  "status": "completed",
  "progress": 100,
  "output_files": [
    "/uploads/PPH/ch1/Manuscript/chapter01_ReferencesStructured.docx",
    "/uploads/PPH/ch1/Manuscript/chapter01_ReferencesLog.xlsx"
  ]
}
```

### **D. All Processing Types**

```bash
POST /api/v1/processing/files/{file_id}/process/{process_type}

Supported process_type values:
  - bias_scan
  - ppd
  - reference_validation
  - reference_structuring
  - reference_number_validation
  - reference_apa_chicago_validation
  - technical
  - word_to_xml
  - credit_extractor_ai
  - permissions
  - structuring
```

---

## **5. REAL-WORLD EXAMPLE: Complete Flow**

### **Scenario: Upload a file and run reference validation**

**Step 1: Authenticate**
```bash
curl -X POST http://localhost:8000/api/v1/users/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=password" \
  -o token.json
```

**Step 2: Extract token**
```bash
# Windows PowerShell
$token = (Get-Content token.json | ConvertFrom-Json).access_token
```

**Step 3: Upload file**
```bash
curl -X POST "http://localhost:8000/api/v1/files/?project_id=42" \
  -H "Authorization: Bearer $token" \
  -F "file=@chapter01.docx" \
  -o upload_response.json

# Extract file_id
$file_id = (Get-Content upload_response.json | ConvertFrom-Json).file_id
```

**Step 4: Trigger reference validation**
```bash
curl -X POST "http://localhost:8000/api/v1/processing/files/$file_id/process/reference_validation" \
  -H "Authorization: Bearer $token" \
  -H "Content-Type: application/json" \
  -d '{}' \
  -o job_response.json

$job_id = (Get-Content job_response.json | ConvertFrom-Json).job_id
```

**Step 5: Poll for completion**
```bash
for ($i = 0; $i -lt 30; $i++) {
    $status = Invoke-RestMethod `
      -Uri "http://localhost:8000/api/v1/processing/files/$file_id/structuring_status" `
      -Headers @{ "Authorization" = "Bearer $token" }
    
    if ($status.status -eq "completed") {
        Write-Host "Processing complete!"
        Write-Host "Output files:"
        $status.output_files | ForEach-Object { Write-Host "  - $_" }
        break
    }
    
    Write-Host "Status: $($status.status) - Progress: $($status.progress)%"
    Start-Sleep -Seconds 3
}
```

---

## **6. PPH INTEGRATION: API CALLS FROM CMS_BACKEND TO PPH**

When cms_backend delegates to PPH for processing:

```
cms_backend                          PPH (Flask)
    │                                   │
    ├─ POST /validate ─────────────────►│
    │  (upload .docx)                   │
    │                                   │
    │◄─ {"job_id": "xyz"} ──────────────┤
    │                                   │
    ├─ GET /progress/xyz ──────────────►│ (poll every 3s)
    │  (check status)                   │
    │                                   │
    │◄─ {"status": "Completed"} ────────┤
    │                                   │
    ├─ GET /download_zip/xyz ──────────►│ (get output)
    │                                   │
    │◄─ [ZIP bytes] ────────────────────┤
    │                                   │
    └─ Save to same folder as input
```

**Example Python code (what cms_backend will do):**

```python
import requests
import time
import zipfile
from pathlib import Path

class PPHClient:
    def __init__(self, base_url, username, password):
        self.base_url = base_url
        self.session = requests.Session()
        self._login(username, password)
    
    def _login(self, username, password):
        """Login to PPH to get session cookie"""
        response = self.session.post(
            f"{self.base_url}/login",
            data={"username": username, "password": password}
        )
        response.raise_for_status()
    
    def submit_job(self, file_path, process_type):
        """Submit file to PPH for processing"""
        with open(file_path, "rb") as fh:
            files = {"files": fh}
            response = self.session.post(
                f"{self.base_url}/validate",
                files=files
            )
        
        return response.json()["job_id"]
    
    def poll_until_done(self, job_id, max_wait_seconds=600):
        """Poll PPH until processing is complete"""
        deadline = time.time() + max_wait_seconds
        
        while time.time() < deadline:
            response = self.session.get(f"{self.base_url}/progress/{job_id}")
            data = response.json()
            
            if data["status"] == "Completed":
                return data
            
            print(f"Status: {data['status']} - Progress: {data.get('current')}/{data.get('total')}")
            time.sleep(3)
        
        raise TimeoutError(f"Job {job_id} did not complete in {max_wait_seconds}s")
    
    def download_output(self, job_id, output_dir):
        """Download results ZIP and extract"""
        response = self.session.get(f"{self.base_url}/download_zip/{job_id}")
        
        # Save and extract ZIP
        zip_path = Path(output_dir) / "output.zip"
        with open(zip_path, "wb") as f:
            f.write(response.content)
        
        # Extract all files
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(output_dir)
        
        return list(Path(output_dir).glob("*.docx")) + list(Path(output_dir).glob("*.xlsx"))

# Usage example:
client = PPHClient("http://10.1.1.69:8081", "admin", "password")
job_id = client.submit_job("chapter01.docx", "reference_validation")
status = client.poll_until_done(job_id)
output_files = client.download_output(job_id, "./outputs")
print(f"Processed files: {output_files}")
```

---

## **7. ERROR HANDLING**

**Common HTTP Status Codes:**

| Code | Meaning | Example |
|------|---------|---------|
| **200** | Success | File uploaded ✓ |
| **201** | Created | Job started ✓ |
| **400** | Bad request | Invalid JSON body |
| **401** | Unauthorized | Token expired or invalid |
| **403** | Forbidden | No permission to access |
| **404** | Not found | File ID doesn't exist |
| **500** | Server error | Backend crash |

**Error Response Example:**
```json
{
  "detail": "File not found",
  "status_code": 404
}
```

**Retry Logic:**
```python
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

session = requests.Session()

# Retry on connection errors, timeouts
retry_strategy = Retry(
    total=3,  # 3 retries
    backoff_factor=1,  # 1s, 2s, 4s delays
    status_forcelist=[500, 502, 503, 504]
)

adapter = HTTPAdapter(max_retries=retry_strategy)
session.mount("http://", adapter)
session.mount("https://", adapter)

response = session.get("http://localhost:8000/api/v1/files/123")
```

---

## **8. TOOLS FOR TESTING API CALLS**

### **Postman (GUI)**
1. Download from https://www.postman.com/downloads/
2. Create new request
3. Set method (GET, POST, etc.)
4. Enter URL
5. Add headers (Authorization, Content-Type)
6. Add body (JSON)
7. Click Send

### **curl (Command line)**
```bash
curl -X POST http://localhost:8000/api/v1/files \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}' \
  -v  # verbose (show request/response)
```

### **Python requests**
```python
import requests

response = requests.post(
    "http://localhost:8000/api/v1/files",
    headers={"Authorization": f"Bearer {token}"},
    json={"key": "value"}
)

print(response.status_code)  # 200, 400, etc.
print(response.json())       # Response body as dict
```

### **PowerShell Invoke-RestMethod**
```powershell
$response = Invoke-RestMethod `
  -Uri "http://localhost:8000/api/v1/files/123" `
  -Method GET `
  -Headers @{
    "Authorization" = "Bearer $token"
  }

$response | ConvertTo-Json
```

---

## **9. FULL API REFERENCE (Quick Lookup)**

### **Authentication**
- `POST /api/v1/users/login` — Get JWT token
- `POST /api/v2/session/login` — Get session cookie

### **Projects**
- `POST /api/v2/projects/bootstrap` — Create project
- `GET /api/v2/projects` — List projects
- `GET /api/v2/projects/{id}` — Get project details

### **Files**
- `POST /api/v1/files/?project_id=X` — Upload file
- `GET /api/v1/files/{id}` — Get file info
- `DELETE /api/v1/files/{id}` — Delete file

### **Processing**
- `POST /api/v1/processing/files/{id}/process/{type}` — Trigger job
- `GET /api/v1/processing/files/{id}/structuring_status` — Check status

### **Available process types**
```
bias_scan, ppd, reference_validation, reference_structuring,
reference_number_validation, reference_apa_chicago_validation,
technical, word_to_xml, credit_extractor_ai, permissions, structuring
```

---

## **10. NEXT STEPS FOR WMS**

During WMS development (Phase 3), you'll build:

1. **Frontend API calls** (React → FastAPI)
   ```javascript
   // JavaScript example
   fetch('/api/v1/files', {
     method: 'POST',
     headers: {
       'Authorization': `Bearer ${token}`,
       'Content-Type': 'application/json'
     },
     body: JSON.stringify({ job_id: 123 })
   })
   .then(r => r.json())
   .then(data => console.log(data))
   ```

2. **Backend service calls** (FastAPI → PPH)
   ```python
   # Python in cms_backend
   client = PPHClient(settings.PPH_URL, settings.PPH_USERNAME, settings.PPH_PASSWORD)
   job_id = client.submit_job(file_path, "reference_validation")
   ```

3. **Database queries** (SQLAlchemy ORM)
   ```python
   # In FastAPI endpoints
   job = db.query(Job).filter(Job.id == 123).first()
   ```

---

## **SUMMARY**

| Layer | Technology | Example Call |
|-------|-----------|--------------|
| **Frontend** | React + fetch/axios | `fetch('/api/v1/files')` |
| **Backend** | FastAPI | `@app.post('/api/v1/files')` |
| **Integration** | requests/httpx | `client.post(url, json=body)` |
| **Database** | PostgreSQL + SQLAlchemy | `db.query(File).all()` |

**Remember:**
- Always authenticate first (get token/cookie)
- Use correct HTTP method (GET, POST, PUT, DELETE)
- Include proper headers (Content-Type, Authorization)
- Handle errors and retry on transient failures
- Test with Postman or curl before coding
