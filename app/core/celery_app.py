from celery import Celery
from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "worker",
    broker=f"redis://localhost:6379/0", # Default Redis URL
    backend=f"redis://localhost:6379/0"
)

celery_app.conf.task_routes = {
    "app.worker.process_document": "main-queue",
}
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
)
