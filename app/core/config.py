
# pyrefly: ignore [missing-import]
from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import Optional

from app.core.paths import UPLOADS_DIR

class Settings(BaseSettings):
    PROJECT_NAME: str = "Publishing CMS"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = "changeme_in_production_secret_key_12345"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    APP_TIMEZONE: str = "Asia/Kolkata"
    
    HOST_DOMAIN: str = "localhost"
    HOST_PORT: int = 8085
    
    DATABASE_URL: str = "postgresql://user:password@localhost/cms_db"
    UPLOAD_FOLDER: str = str(UPLOADS_DIR)
    REDIS_URL: str = "redis://localhost:6379/0"
    INDESIGN_SERVER_URL: str = "http://10.1.6.108:5555"
    ALLOWED_ORIGINS: list[str] = [
        "http://localhost:8085",
        "http://localhost:8080",
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:8085",
        "http://127.0.0.1:8080",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "http://10.1.1.18:8085",
        "http://10.1.1.18",
        "https://10.1.1.18:8085",
        "https://10.1.1.18",
    ]

    # Optional external AI Structuring service integration (disabled by default)
    # When AI_STRUCTURING_BASE_URL is set, the StructuringEngine can offload structuring
    # to an external service and pull the processed DOCX back into the CMS.
    AI_STRUCTURING_BASE_URL: str = ""
    AI_STRUCTURING_API_KEY: str = ""
    AI_STRUCTURING_DOCUMENT_TYPE: str = "Academic Document"
    AI_STRUCTURING_USE_MARKERS: bool = False
    AI_STRUCTURING_POLL_INTERVAL_SECONDS: int = 2
    AI_STRUCTURING_MAX_WAIT_SECONDS: int = 900
    AI_STRUCTURING_REQUEST_TIMEOUT_SECONDS: int = 30

    # External PPH Server processing integration settings
    PPH_ENABLED: bool = False
    PPH_BASE_URL: str = "http://[IP_ADDRESS]"
    PPH_USERNAME: str = "admin"
    PPH_PASSWORD: str = "Murali@12"
    PPH_MAX_WAIT_SECONDS: int = 4500   # 75 min — covers worst-case 1-hour jobs with headroom
    PPH_POLL_INTERVAL_SECONDS: int = 20  # Poll every 20s; jobs run 30-60 min so 2s is excessive

    # PPH Reference Conversion settings (for reference_structuring process type)
    REF_SOURCE_STYLE: str = "Auto"  # Auto, AMA, APA, CGRN
    REF_TARGET_STYLE: str = "APA"   # AMA, APA, CGRN

    SMTP_FROM: str = "inkflow-noreply@example.com"
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 25
    SMTP_USERNAME: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_USE_TLS: bool = False
    SMTP_USE_SSL: bool = False

    def __init__(self, **values):
        super().__init__(**values)
        # Dynamically append host domain/port to ALLOWED_ORIGINS
        host_origin = f"http://{self.HOST_DOMAIN}"
        if self.HOST_PORT not in (80, 443):
            host_origin = f"http://{self.HOST_DOMAIN}:{self.HOST_PORT}"
        
        host_origin_https = f"https://{self.HOST_DOMAIN}"
        if self.HOST_PORT not in (80, 443):
            host_origin_https = f"https://{self.HOST_DOMAIN}:{self.HOST_PORT}"
            
        for origin in [host_origin, host_origin_https, f"http://{self.HOST_DOMAIN}", f"https://{self.HOST_DOMAIN}"]:
            if origin not in self.ALLOWED_ORIGINS:
                self.ALLOWED_ORIGINS.append(origin)

    class Config:
        env_file = (".env", ".env.local")  # .env.local overrides .env (last wins in pydantic-settings v2)
        extra = "ignore"

@lru_cache()
def get_settings():
    return Settings()
