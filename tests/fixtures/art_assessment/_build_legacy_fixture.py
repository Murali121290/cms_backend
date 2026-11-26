"""Build tests/fixtures/art_assessment/legacy_generated.xlsx.

Mirrors the 15-column layout that
``app.domains.post_prod.figure_pdf.service.generate_figure_assessment``
currently emits (see service.py:1059-1075). Kept as a small script so
anyone can rebuild the fixture without pulling in the whole service.

Run from the repo root:

    python tests/fixtures/art_assessment/_build_legacy_fixture.py
"""

from pathlib import Path

from openpyxl import Workbook

HEADERS = (
    "ART NAME",
    "FIGURE NO.",
    "PART NO.",
    "TYPE",
    "ART CLASSIFICATION",
    "SUPPLIED IMAGE COLOR",
    "SUPPLIED IMAGE MODE",
    "SUPPLIED IMAGE TYPE",
    "SUPPLIED SIZE",
    "FINAL SIZE",
    "SPECIAL INSTRUCTION ",   # trailing space is intentional, matches service.py
    "FINAL ART COLOR",
    "COMPLEXITY",
    "RESOLUTION (HALFTONE ONLY)",
    "STATUS",
)

ROWS = [
    # (filename, figure_no, part, type_, classification, supp_color, supp_mode,
    #  supp_type, supp_size, final_size, special_instruction, final_art_color,
    #  complexity, resolution, status)
    ("Figure1.1.jpg", "1.1", "", "Figure", "", "RGB",      "RGB", "JPEG", "236 K", "", "", "", "", "300 DPI", ""),
    ("Figure1.2.tif", "1.2", "a", "Figure", "", "CMYK",    "CMYK", "TIFF", "1 MB",  "", "", "", "", "600 DPI", ""),
    ("Figure1.3.png", "1.3", "",  "Figure", "", "Grayscale", "L",   "PNG",  "902 K", "", "", "", "", "",         ""),
]


def main() -> None:
    out = Path(__file__).with_name("legacy_generated.xlsx")
    wb = Workbook()
    ws = wb.active
    ws.title = "1. Legacy Chapter"
    for col_idx, header in enumerate(HEADERS, start=1):
        ws.cell(row=1, column=col_idx, value=header)
    for row_idx, values in enumerate(ROWS, start=2):
        for col_idx, value in enumerate(values, start=1):
            ws.cell(row=row_idx, column=col_idx, value=value)
    wb.save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
