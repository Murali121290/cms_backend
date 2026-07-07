from celery import Celery
from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "worker",
    broker=getattr(settings, "REDIS_URL", "redis://localhost:6379/0"),
    backend=getattr(settings, "REDIS_URL", "redis://localhost:6379/0"),
    include=["app.core.worker"]
)

celery_app.conf.task_routes = {
    "app.core.worker.process_document": "main-queue",
    "app.core.worker.run_post_prod_conversion_task": "main-queue",
}
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
)
