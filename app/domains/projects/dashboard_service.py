from sqlalchemy.orm import Session

from app.services import project_service


def get_dashboard_page_data(db: Session, *, skip: int = 0, limit: int = 100):
    projects = project_service.get_projects(db, skip=skip, limit=limit)

    return {
        "projects": projects,
        "dashboard_stats": {
            "total_projects": len(projects),
            "on_time_rate": 94,
            "on_time_trend": "+12%",
            "avg_days": 8.5,
            "avg_days_trend": "-2 days",
            "delayed_count": 0,
            "delayed_trend": "0",
        },
    }
