"""Utility functions for word conversion operations."""

import re
from sqlalchemy.orm import Session
from app.domains.post_prod.models import PostProdProject, PostProdChapter


def parse_chapter_number(filename: str) -> str:
    """
    Parse chapter number from filename.

    Examples:
        Ch_01.indd → "1"
        chapter02.indd → "2"
        document.indd → "1" (default)
    """
    match = re.search(r'(?:ch|chap|chapter|c)[^\d]*(\d+)', filename, re.IGNORECASE)
    if match:
        return str(int(match.group(1)))
    match_digits = re.search(r'(\d+)', filename)
    if match_digits:
        return str(int(match_digits.group(1)))
    return "1"


def get_chapter_from_string(text: str) -> str | None:
    """
    Extract chapter number from filename or path.

    Used to prevent showing files belonging to other chapters.

    Args:
        text: Filename or path to scan

    Returns:
        Chapter number as string, or None if not found
    """
    match = re.search(r'(?:\b|_|-)(?:ch|chap|chapter|c)[^\d\w]*(\d+)', text, re.IGNORECASE)
    if match:
        return str(int(match.group(1)))

    # Standalone numbers or numbers preceded by separator: e.g. "image_01.png", "01.png"
    matches = re.findall(r'(?:\b|_|-)(\d+)(?:\b|_|-)', text)
    if matches:
        return str(int(matches[0]))

    return None


def check_and_update_project_status(db: Session, project_name: str, client_code: str) -> None:
    """
    Update project status to 'Completed' if all chapters are completed.

    Args:
        db: Database session
        project_name: Project name
        client_code: Client code
    """
    project = db.query(PostProdProject).filter(
        PostProdProject.project_name == project_name,
        PostProdProject.client_code == client_code
    ).first()
    if not project:
        return

    chapters = db.query(PostProdChapter).filter(
        PostProdChapter.project_name == project_name,
        PostProdChapter.client_code == client_code
    ).all()

    if chapters and all(c.status == "Completed" for c in chapters):
        project.status = "Completed"
        db.commit()
