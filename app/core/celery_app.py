from celery import Celery
from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "worker",
    broker=getattr(settings, "REDIS_URL", "redis://localhost:6379/0"),
    backend=getattr(settings, "REDIS_URL", "redis://localhost:6379/0"),
    include=["app.core.worker", "app.domains.books_on_demand.tasks"]
)

celery_app.conf.task_routes = {
    "app.core.worker.process_document": "main-queue",
    "app.core.worker.run_post_prod_conversion_task": "main-queue",
    "app.core.worker.run_epub_validation_task": "main-queue",
    "app.domains.books_on_demand.tasks.watch_ftp_for_new_pdfs": "main-queue",
}
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
)

celery_app.conf.beat_schedule = {
    "watch_ftp_for_bod_pdfs_every_1_min": {
        "task": "app.domains.books_on_demand.tasks.watch_ftp_for_new_pdfs",
        "schedule": 60.0, # Every 1 minute
    },
}
