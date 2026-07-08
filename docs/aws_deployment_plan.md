# AWS Compatibility and Deployment Plan

This document outlines the architecture, configuration changes, and provisioning steps required to deploy the **CMS Backend** and its associated services (FastAPI, React Frontend, Celery Workers, Redis, PostgreSQL, Collabora, OnlyOffice) to **Amazon Web Services (AWS)**.

---

## Architecture Overview

To transition from a single-host `docker-compose` environment to a secure, scalable, and highly available AWS environment, we propose the following multi-AZ cloud-native architecture:

```mermaid
graph TD
    User([User Browser]) -->|HTTPS: 443| CF[Amazon CloudFront CDN]
    CF -->|Static Assets: /*| S3_Front[Amazon S3: Frontend Web Assets]
    CF -->|Dynamic Traffic: /api/*, /wopi/*, /webdav/*, /coolws/*| ALB[Application Load Balancer]
    
    subgraph VPC [AWS VPC]
        subgraph PublicSubnets [Public Subnets]
            ALB
            NAT[NAT Gateways]
        end
        
        subgraph PrivateSubnets [Private Subnets]
            subgraph ECS_Cluster [ECS Cluster - Fargate]
                API[FastAPI Backend Tasks]
                Worker[Celery Worker Tasks]
                Collab[Collabora Online Tasks]
                Only[OnlyOffice Tasks]
                AI[AI Structuring Tasks]
            end
            
            EFS[Amazon Elastic File System - EFS]
        end
        
        subgraph IsolatedSubnets [Isolated Subnets]
            RDS[(Amazon RDS: PostgreSQL)]
            Cache[(Amazon ElastiCache: Redis)]
        end
    end
    
    %% Traffic flows
    ALB -->|Port 8000| API
    ALB -->|Port 9980| Collab
    ALB -->|Port 8083| Only
    
    %% Mounts
    API ---|Mounts /opt/cms_runtime| EFS
    Worker ---|Mounts /opt/cms_runtime| EFS
    AI ---|Mounts /opt/cms_runtime| EFS
    
    %% Internal Connectivity
    API --> RDS
    API --> Cache
    Worker --> RDS
    Worker --> Cache
    AI --> RDS
    AI --> Cache
    
    %% Egress
    ECS_Cluster -->|Internet Access| NAT
    NAT -->|Outbound Integrations| ExtAPI[External AI / PPH / WebDAV Servers]
```

---

## Key Architectural Decisions

### 1. File Storage: Amazon EFS vs. Amazon S3
* **The Challenge:** The codebase uses standard Python file APIs (`open`, `os.path.join`, `shutil`) heavily for document processing, conversion, and uploads. In a distributed environment with multiple container instances (ECS tasks), local volumes are ephemeral and not shared.
* **Our Recommendation (Amazon EFS):**
  Using **Amazon EFS (Elastic File System)** allows us to mount a persistent network directory directly to `/opt/cms_runtime` across the FastAPI Backend, Celery Workers, and AI Structuring tasks.
  * **Benefit:** It acts as a standard POSIX filesystem. This ensures **100% compatibility with zero code changes** in how files are read, written, and structured during pipeline execution.
* **Alternative (Amazon S3):**
  Requires rewriting file storage service functions to use `boto3` for S3 upload/download. While more cost-effective for pure storage, it introduces refactoring complexity. We suggest keeping EFS for immediate compatibility and writing an S3 archival task for completed projects.

### 2. Databases: RDS & ElastiCache
* **PostgreSQL:** Move from the containerized DB to **Amazon RDS for PostgreSQL** (or **Amazon Aurora Serverless v2**). This provides automated patching, daily backups, and multi-AZ failover capabilities.
* **Redis:** Move from the containerized Redis to **Amazon ElastiCache for Redis (Serverless)**, offering managed high-availability clustering for Celery tasks and scheduling.

### 3. Compute Layer: ECS Fargate
* Deploy backend, celery worker, Collabora, and OnlyOffice services as containerized tasks in an **Amazon ECS (Elastic Container Service)** cluster running on **Fargate** (serverless containers).
* **Fargate** eliminates the need to manage EC2 instances, handles scaling based on CPU/Memory metrics, and operates on a pay-as-you-go model.

### 4. Secrets Management
* Store env-level values (e.g. database credentials, secrets, external API keys) in **AWS Secrets Manager** or **AWS Systems Manager Parameter Store**.
* ECS will inject these values securely as environment variables at task launch.

---

## Step-by-Step Implementation Plan

### Step 1: Infrastructure Provisioning (Terraform)
We will use **Terraform** to declare the required infrastructure. Below is an architectural blueprint outlining the required Terraform resources:

#### `[NEW]` [main.tf](file:///d:/Main/cms_backend/main.tf)
```hcl
# AWS Provider Configuration
provider "aws" {
  region = var.aws_region
}

# 1. Network Layer (VPC)
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "cms-prod-vpc"
  cidr = "10.0.0.0/16"

  azs              = ["us-east-1a", "us-east-1b"]
  public_subnets   = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnets  = ["10.0.10.0/24", "10.0.11.0/24"]
  database_subnets = ["10.0.20.0/24", "10.0.21.0/24"]

  enable_nat_gateway   = true
  single_nat_gateway   = true
  enable_dns_hostnames = true
}

# 2. Database Layer (RDS PostgreSQL)
resource "aws_db_instance" "postgres" {
  identifier           = "cms-prod-db"
  allocated_storage    = 20
  max_allocated_storage = 100
  engine               = "postgres"
  engine_version       = "15.5"
  instance_class       = "db.t4g.medium"
  db_name              = "cms_db"
  username             = "cms_admin"
  password             = var.db_password
  db_subnet_group_name = module.vpc.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.db.id]
  skip_final_snapshot  = true
}

# 3. Cache/Broker Layer (ElastiCache Redis)
resource "aws_elasticache_serverless_cache" "redis" {
  engine = "redis"
  name   = "cms-prod-redis"
  major_engine_version = "7"
  subnet_ids = module.vpc.private_subnets
  security_group_ids = [aws_security_group.redis.id]
}

# 4. Shared Storage (Amazon EFS)
resource "aws_efs_file_system" "cms_storage" {
  creation_token = "cms-runtime-efs"
  encrypted      = true
  tags = {
    Name = "cms-shared-storage"
  }
}

# Mount target is necessary so tasks can connect to the EFS volume
resource "aws_efs_mount_target" "mount" {
  count           = 2
  file_system_id  = aws_efs_file_system.cms_storage.id
  subnet_id       = module.vpc.private_subnets[count.index]
  security_group_ids = [aws_security_group.efs.id]
}

# 5. Container Orchestration (ECS)
resource "aws_ecs_cluster" "ecs_cluster" {
  name = "cms-prod-cluster"
}

# ECS Execution Role and Task Role Definitions
# Define Task Definitions for Backend, Celery Worker, Collabora, and OnlyOffice...
```

### Step 2: Environment Configuration Adjustments
Update `.env` configuration mapping to support the AWS database, cache, and filesystem targets. 

Create a production environment template:
#### `[NEW]` [.env.production](file:///d:/Main/cms_backend/.env.production)
```ini
# Core Backend Settings
PROJECT_NAME="CMS Production Platform"
API_V1_STR="/api/v1"
SECRET_KEY="<PROD_SECRET_KEY>" # Managed by AWS Secrets Manager
ALGORITHM="HS256"
ACCESS_TOKEN_EXPIRE_MINUTES=60
APP_TIMEZONE="Asia/Kolkata"

# DB Connection (Set via AWS Secrets Manager)
# Format: postgresql://cms_admin:<password>@<rds-endpoint>:5432/cms_db
DATABASE_URL="postgresql://cms_admin:placeholder@prod-rds-endpoint:5432/cms_db"

# Redis Connection (AWS ElastiCache Redis endpoint)
REDIS_URL="redis://prod-redis-endpoint:6379/0"

# Paths Configuration
# Mount target in ECS task will map EFS to this location
CMS_RUNTIME_ROOT="/opt/cms_runtime"

# Domain & Port Setup (External domain fronted by CloudFront/ALB)
HOST_DOMAIN="cms.yourdomain.com"
HOST_PORT="443"
COOKIE_SECURE="true"

# Editor Container Locations (Routed internally through ALB or ECS discovery)
COLLABORA_URL="http://collabora.local:9980"
WOPI_BASE_URL="http://backend.local:8000"
```

### Step 3: Container Readiness (Docker Optimization)
Ensure that Docker containers are production-ready:
1. **Remove Bind Mounts in ECS Task Definitions:** Ensure that configuration references local paths (e.g. `./outputs`, `./data`) using EFS mount volumes rather than local bind mounts.
2. **Optimize Health Checks:**
   Define the container health checks in ECS task definitions so failing backend containers can be replaced automatically.
3. **Handle Celery Lifecycle:**
   Add proper container termination policies so Celery tasks finish before a container is terminated during scaling actions.

### Step 4: Frontend Hosting
Deploy the static React assets to S3 and CloudFront.
1. Build the frontend app:
   ```bash
   cd frontend
   npm ci
   npm run build
   ```
2. Upload the contents of `frontend/dist/` to an Amazon S3 bucket (`cms-frontend-web-assets`).
3. Set up **Amazon CloudFront** distributing the S3 bucket with an **Origin Access Control (OAC)** policy to protect S3 from direct public access.
4. Route endpoints like `/api/*`, `/wopi/*`, `/coolws/*` from CloudFront to the ALB backend listener target group.

### Step 5: Continuous Integration and Deployment (CI/CD)
Configure a GitHub Actions pipeline to compile, test, containerize, and deploy updates.

#### `[NEW]` [deploy.yml](file:///d:/Main/cms_backend/.github/workflows/deploy.yml)
```yaml
name: Deploy to Amazon ECS

on:
  push:
    branches: [ "main" ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
    - name: Checkout Code
      uses: actions/checkout@v3

    - name: Configure AWS Credentials
      uses: aws-actions/configure-aws-credentials@v2
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: us-east-1

    - name: Login to Amazon ECR
      id: login-ecr
      uses: aws-actions/amazon-ecr-login@v1

    - name: Build, tag, and push Backend Image
      env:
        ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
        ECR_REPOSITORY: cms-backend
        IMAGE_TAG: ${{ github.sha }}
      run: |
        docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG -t $ECR_REGISTRY/$ECR_REPOSITORY:latest .
        docker push $ECR_REGISTRY/$ECR_REPOSITORY --all-tags

    - name: Deploy Amazon ECS Task Definition
      uses: aws-actions/amazon-ecs-deploy-task-definition@v1
      with:
        task-definition: task-definition.json
        service: cms-backend-service
        cluster: cms-prod-cluster
        wait-for-service-stability: true
```

---

## Verification and Testing Plan

### Automated Verification
* Run tests inside the target CI/CD environment prior to deployment to verify all routes remain stable:
  ```bash
  pytest tests/
  ```

### Manual Infrastructure Verification
1. **Network Connectivity:** Verify the ECS FastAPI Backend task can connect to the RDS PostgreSQL instance and ElastiCache Redis broker.
2. **Storage Capabilities (EFS):** Verify uploads write successfully from backend containers to the `/opt/cms_runtime/data/uploads` path and can be parsed immediately by Celery workers.
3. **Collabora / OnlyOffice Connectivity:** Launch a document edit session inside the browser to verify the WOPI routing works seamlessly through the ALB.
