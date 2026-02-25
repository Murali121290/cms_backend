
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    PROJECT_NAME: str = "Publishing CMS"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = "changeme_in_production_secret_key_12345"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    # Database
    DATABASE_URL: str = "postgresql://user:password@localhost/cms_db"
    REDIS_URL: str = "redis://localhost:6379/0"

    class Config:
        env_file = ".env"

@lru_cache()
def get_settings():
    return Settings()
