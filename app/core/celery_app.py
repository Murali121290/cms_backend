from celery import Celery
from celery.schedules import crontab
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
    "app.core.worker.run_xml_conversion_celery_task": "main-queue",
    "app.domains.books_on_demand.tasks.watch_ftp_for_new_pdfs": "main-queue",
    "app.domains.books_on_demand.tasks.send_bod_daily_receipt_summary": "main-queue",
}
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Kolkata",
    enable_utc=True,
)

celery_app.conf.beat_schedule = {
    "watch_ftp_for_bod_pdfs_every_1_min": {
        "task": "app.domains.books_on_demand.tasks.watch_ftp_for_new_pdfs",
        "schedule": 60.0, # Every 1 minute
    },
}

# Add daily summary schedule ONLY IF explicitly configured in environment (no default)
summary_time_str = getattr(settings, "BOD_DAILY_SUMMARY_TIME", None)
if summary_time_str and str(summary_time_str).strip():
    try:
        clean_time = str(summary_time_str).strip()
        summary_hour, summary_minute = [int(p) for p in clean_time.split(":", 1)]
        celery_app.conf.beat_schedule["send_bod_daily_receipt_summary"] = {
            "task": "app.domains.books_on_demand.tasks.send_bod_daily_receipt_summary",
            "schedule": crontab(hour=summary_hour, minute=summary_minute, day_of_week="mon-sat"),
        }
    except Exception as err:
        import logging
        logging.getLogger("app.celery").warning(f"Invalid BOD_DAILY_SUMMARY_TIME '{summary_time_str}': {err}. Daily summary not scheduled.")
