# System Requirements — CMS Backend + PPH Development Setup

## Minimum Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **CPU** | 4 cores | 8 cores |
| **RAM** | 8 GB | 16 GB |
| **Disk Space** | 50 GB free | 100 GB free |
| **OS** | Windows 10/11, macOS 11+, Ubuntu 20.04+ | Windows 11 Pro, macOS 12+, Ubuntu 22.04 |

---

## Software Requirements

### **1. Docker Desktop**
- **Version:** 4.20+ (latest stable)
- **Download:** https://www.docker.com/products/docker-desktop
- **Includes:** Docker Engine, Docker Compose, Kubernetes (optional)
- **Disk:** ~5 GB for Docker runtime

### **2. Git**
- **Version:** 2.30+
- **Download:** https://git-scm.com/download
- **Used for:** Cloning repositories, version control

### **3. Python** (for local development, optional)
- **Version:** 3.11 or 3.12
- **Download:** https://www.python.org/downloads
- **Used for:** Running scripts outside Docker if needed

### **4. Text Editor / IDE** (choose one)
- **VS Code** (recommended) — https://code.visualstudio.com
- **JetBrains PyCharm** — https://www.jetbrains.com/pycharm
- **Any editor with Git support**

### **5. Postman** (optional, for API testing)
- **Version:** Latest
- **Download:** https://www.postman.com/downloads
- **Used for:** Testing API endpoints

---

## Network Requirements

| Service | Port | Protocol | Purpose |
|---------|------|----------|---------|
| **cms_backend** | 8000 | HTTP | FastAPI backend |
| **PPH Flask** | 5001 | HTTP | PPH hub server |
| **PostgreSQL (DB)** | 5432 | TCP | Database (internal) |
| **Redis** | 6379 | TCP | Caching (internal) |
| **Collabora Online** | 9980 | HTTP | Document editor |
| **nginx (reverse proxy)** | 8080 | HTTP | Public-facing |

**Note:** When running on Docker Desktop, all services run in containers. Port mappings are:
- `localhost:8000` → cms_backend
- `localhost:5001` → PPH
- `localhost:8080` → nginx (public)

---

## Disk Space Breakdown

| Component | Size |
|-----------|------|
| Docker Desktop | ~5 GB |
| cms_backend image | ~1.5 GB |
| PPH image | ~1.5 GB |
| PostgreSQL image | ~500 MB |
| Redis image | ~200 MB |
| Collabora image | ~2 GB |
| Build artifacts / temp | ~5-10 GB |
| **TOTAL** | **~15-20 GB** |

**Recommendation:** Keep at least 50 GB free on your primary drive.

---

## Windows-Specific Requirements

### **For Windows 11 Pro / Enterprise:**
- **WSL 2** (Windows Subsystem for Linux 2) — automatically installed by Docker Desktop
- **Virtualization enabled** in BIOS (usually enabled by default)
- **Hyper-V** — enabled automatically by Docker Desktop

### **For Windows 11 Home:**
- Docker Desktop works but with reduced performance
- WSL 2 required
- No native Hyper-V support (uses lightweight virtualization)

### **Verify WSL 2 is working:**
```bash
wsl --version
# Should output: WSL version: X.X.X.X
```

---

## macOS-Specific Requirements

### **For Apple Silicon (M1, M2, M3):**
- **Docker Desktop 4.6+** (with native ARM64 support)
- Images must be ARM64-compatible
- Slower performance than on Intel Macs

### **For Intel Macs:**
- **macOS 11+** (Big Sur or later)
- **Docker Desktop 4.20+**
- Native x86_64 support

---

## Linux-Specific Requirements

### **Ubuntu 20.04+ or Debian 11+:**
```bash
# Install Docker
sudo apt update
sudo apt install docker.io docker-compose

# Add user to docker group (avoid sudo)
sudo usermod -aG docker $USER
```

### **CentOS / RHEL:**
```bash
sudo yum install docker docker-compose
sudo systemctl start docker
```

---

## Pre-Flight Checklist

Run this to verify your system is ready:

### **Windows PowerShell:**
```powershell
# Check Docker
docker --version
docker-compose --version

# Check Git
git --version

# Check virtualization (Windows only)
Get-WmiObject -Class Win32_Processor | Select-Object Name, VirtualizationFirmwareEnabled
```

### **macOS / Linux:**
```bash
# Check Docker
docker --version
docker-compose --version

# Check Git
git --version

# Check system resources
free -h       # Linux
vm_stat       # macOS
```

---

## Performance Tuning (Docker Desktop)

### **Windows / macOS:**
1. Open **Docker Desktop** → **Settings** → **Resources**
2. Set:
   - **CPUs:** 4-6 (leave 2 for OS)
   - **Memory:** 8-12 GB (leave 2-4 GB for OS)
   - **Swap:** 2 GB
   - **Disk Image Size:** 50+ GB
3. Click **Apply & Restart**

### **Linux:**
- No resource limits by default (uses host OS)
- Adjust via `docker run --memory` and `--cpus` flags if needed

---

## Connectivity Requirements

| Service | Requires Internet? | Purpose |
|---------|-------------------|---------|
| Docker pull | YES | Download images from Docker Hub |
| Gemini API | YES (optional) | Reference conversion AI (PPH) |
| Build/compilation | NO | Can be offline once images pulled |
| Runtime | NO | All services run locally in containers |

**Note:** First docker-compose up will require internet to pull ~3 GB of images.

---

## Summary — Quick Start

✅ **You need:**
- Docker Desktop 4.20+
- 50 GB free disk space
- 8 GB RAM (16 GB recommended)
- Git
- Terminal / PowerShell / Bash
- Text editor (VS Code recommended)

✅ **Optional but recommended:**
- Postman (for API testing)
- Python 3.11+ (for local development)
- WSL 2 (Windows only, auto-installed by Docker)

✅ **For reference conversion (Gemini AI):**
- Set `REFERENCE_CONVERTER_GEMINI_API_KEY` in PPH `.env`
- Requires Google Gemini API key (get from: https://makersuite.google.com/app/apikey)

---

## Next Steps

Once you have these installed:
1. Clone the repos
2. Run `docker-compose up`
3. Access:
   - **cms_backend:** http://localhost:8000
   - **PPH:** http://localhost:5001
   - **Nginx:** http://localhost:8080

See `DOCKER_SETUP.md` for detailed instructions.
