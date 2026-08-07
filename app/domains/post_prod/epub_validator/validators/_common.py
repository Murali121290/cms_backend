"""Shared helpers for Aspen validators."""

import glob
import os


def find_opf(epub_folder: str) -> str | None:
    matches = glob.glob(os.path.join(epub_folder, "**", "*.opf"), recursive=True)
    return matches[0] if matches else None


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()
