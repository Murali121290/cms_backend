import os
import shutil
import zipfile
from pathlib import Path
from typing import Optional

from .upload_service import UPLOAD_DIR, EXTRACT_DIR


def repack_epub(folder_name: str) -> Path:
    """Repack the extracted `epub/` directory back into a standard EPUB 3 archive.

    Guarantees that:
    1. `mimetype` file is stored uncompressed (ZIP_STORED) as the very first entry.
    2. Overwrites `uploads/<folder_name>/extract/<folder_name>.epub`.
    3. Saves a clean copy to `<UPLOAD_DIR>/<folder_name>/output/<folder_name>.epub`.
    """
    upload_root = Path(UPLOAD_DIR)
    folder_path = upload_root / folder_name
    extract_path = folder_path / EXTRACT_DIR
    unzipped_epub_dir = extract_path / "epub"

    output_dir = folder_path / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_epub_path = output_dir / f"{folder_name}.epub"

    extract_epub_path = extract_path / f"{folder_name}.epub"

    if not unzipped_epub_dir.is_dir():
        # Fallback to existing epub file if extract/epub folder does not exist
        if extract_epub_path.is_file():
            shutil.copy2(extract_epub_path, output_epub_path)
            return extract_epub_path
        return extract_epub_path

    # Temporary output file while building zip
    tmp_epub_path = extract_path / f"{folder_name}.tmp.epub"
    if tmp_epub_path.exists():
        tmp_epub_path.unlink()

    with zipfile.ZipFile(tmp_epub_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        # 1. Write `mimetype` first, uncompressed (per EPUB 3 spec)
        mimetype_path = unzipped_epub_dir / "mimetype"
        if mimetype_path.is_file():
            zf.write(mimetype_path, arcname="mimetype", compress_type=zipfile.ZIP_STORED)
        else:
            zf.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)

        # 2. Write all other files
        for root, _dirs, files in os.walk(unzipped_epub_dir):
            for file in files:
                full_p = Path(root) / file
                rel_p = full_p.relative_to(unzipped_epub_dir)
                if rel_p.as_posix() == "mimetype" or file.startswith("._"):
                    continue
                zf.write(full_p, arcname=rel_p.as_posix())

    # Replace primary extract EPUB file and copy to output folder
    if extract_epub_path.exists():
        extract_epub_path.unlink()
    tmp_epub_path.rename(extract_epub_path)

    shutil.copy2(extract_epub_path, output_epub_path)
    return extract_epub_path
