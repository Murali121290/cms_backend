"""
Master IA template rows for Editorial Stylesheet creation.
Each entry: (element, subtype, pattern, example_or_None)

Copied from PPH manuscript_core/ia_mapping.py — not imported live.
"""

IA_TEMPLATE_ROWS: list[tuple[str, str, str, str | None]] = [
    # Figure
    ("Figure", "Caption", "Figure ^#", "Figure 1"),
    ("Figure", "Citation", "Figure ^#", "Figure 1"),
    ("Figure", "Caption", "Figure ^#.^#", "Figure 1.1"),
    ("Figure", "Citation", "Figure ^#.^#", "Figure 1.1"),
    ("Figure", "Caption", "Figure ^#-^#", "Figure 1-1"),
    ("Figure", "Citation", "Figure ^#-^#", "Figure 1-1"),
    ("Figure", "Caption", "Fig ^#", "Fig 1"),
    ("Figure", "Citation", "Fig ^#", "Fig 1"),
    ("Figure", "Caption", "figure ^# (lowercase)", None),
    ("Figure", "Citation", "figure ^# (lowercase)", None),
    # Table
    ("Table", "Caption", "Table ^#", "Table 1"),
    ("Table", "Citation", "Table ^#", "Table 1"),
    ("Table", "Caption", "Table ^#.^#", "Table 1.1"),
    ("Table", "Citation", "Table ^#.^#", "Table 1.1"),
    ("Table", "Caption", "Tab ^#", "Tab 1"),
    ("Table", "Citation", "Tab ^#", "Tab 1"),
    ("Table", "Caption", "table ^# (lowercase)", None),
    ("Table", "Citation", "table ^# (lowercase)", None),
    # Box
    ("Box", "Caption", "Box ^#", "Box 1"),
    ("Box", "Citation", "Box ^#", "Box 1"),
    ("Box", "Caption", "Box ^#.^#", "Box 1.1"),
    ("Box", "Caption", "box ^# (lowercase)", None),
    # Chart
    ("Chart", "Caption", "Chart ^#", "Chart 1"),
    ("Chart", "Citation", "Chart ^#", "Chart 1"),
    ("Chart", "Caption", "Chart ^#.^#", "Chart 1.1"),
    # Chapter
    ("Chapter", "General", "Chapter ^#", None),
    ("Chapter", "General", "Chapters ^#-^#", None),
    ("Chapter", "General", "chapter ^# (lowercase)", None),
    # Section
    ("Section", "General", "Section ^#", None),
    ("Section", "General", "Section ^#.^#", None),
    ("Section", "General", "Sections ^#-^#", None),
    # Numbers
    ("Numbers", "General", "0 to 9 numerals", None),
    ("Numbers", "General", "0 to 9 spelled out", None),
    ("Numbers", "General", "0 to 99 numerals", None),
    ("Numbers", "General", "0 to 99 spelled out", None),
    # Percent
    ("Percent", "General", "%", None),
    ("Percent", "General", "percent", None),
    ("Percent", "General", "per cent", None),
    ("Percent", "General", "percentage", None),
    # Ranges
    ("Ranges", "General", "X to Y", None),
    ("Ranges", "General", "X–Y (en dash)", None),
    ("Ranges", "General", "X-Y (hyphen)", None),
    # Ordinals
    ("Ordinals - numerals", "General", "^#st", None),
    ("Ordinals - numerals", "General", "^#nd", None),
    ("Ordinals - numerals", "General", "^#rd", None),
    ("Ordinals - numerals", "General", "^#th", None),
    ("Ordinals - spelled out", "General", "first, second, ... hundredth", None),
    # Quote marks
    ("Quote marks", "General", "Double quote marks (curly pairs)", None),
    ("Quote marks", "General", "Single quote marks (curly pairs)", None),
    ("Quote marks", "General", "Double quote marks (straight)", None),
    ("Quote marks", "General", "Single quote marks (straight)", None),
    # Ellipse
    ("Ellipse", "General", "... symbol (three ASCII dots)", None),
    ("Ellipse", "General", "… three dots without spaces", None),
    ("Ellipse", "General", ". . . Three dots with spaces", None),
    # Dates
    ("UK date", "General", "D Mon YYYY (long form)", "1 Jan 2020"),
    ("UK date", "General", "D/M/YY or D/M/YYYY", None),
    ("US date", "General", "Month D, YYYY (long form)", "January 1, 2020"),
    # Spelling
    ("Spelling", "style", "American", None),
    ("Spelling", "style", "British", None),
    # Latin abbreviations
    ("Latin abbreviations", "General", "e.g.", None),
    ("Latin abbreviations", "General", "eg", None),
    ("Latin abbreviations", "General", "i.e.", None),
    ("Latin abbreviations", "General", "ie", None),
    ("Latin abbreviations", "General", "etc.", None),
    # Versus
    ("Versus", "General", "versus", None),
    ("Versus", "General", "vs.", None),
    ("Versus", "General", "vs", None),
    # Symbols
    ("Symbols", "General", "™ trademark symbol", None),
    ("Symbols", "General", "® registered symbol", None),
    ("Symbols", "General", "© copyright symbol", None),
    # Units abbreviated
    ("Units (abbreviated)", "General", "mg", "mg"),
    ("Units (abbreviated)", "General", "kg", "kg"),
    ("Units (abbreviated)", "General", "mL / ml", "mL"),
    ("Units (abbreviated)", "General", "mm", "mm"),
    ("Units (abbreviated)", "General", "cm", "cm"),
    # Degree
    ("Degree Celsius", "General", "°C", None),
    ("Degree Fahrenheit", "General", "°F", None),
    ("Degree spelled", "General", "degree(s) (spelled)", None),
    # Fractions
    ("Fractions", "General", "½ [symbol]", None),
    ("Fractions", "General", "^#/^# [slash]", None),
    # Leading zero
    ("Leading zero", "General", "0.^#", None),
    ("Leading zero (NO)", "General", ".^#", None),
    # Thousand separator
    ("Thousand separator (use/non-use)", "General", "1,000 (comma)", None),
    ("Thousand separator (use/non-use)", "General", "1000 (none)", None),
    # Citations
    ("Citations", "Citation", "Bracketed numeric", "[1]"),
    # Positional ref
    ("Positional ref", "General", "see below", None),
    ("Positional ref", "General", "see above", None),
    # Fold
    ("Fold", "General", "^#fold", None),
    ("Fold", "General", "^#-fold", None),
    ("Fold", "General", "[word]fold", None),
    # Times
    ("Times", "General", "^# times", None),
    ("Times", "General", "twice", None),
    # Inline lists
    ("Inline lists", "General", "(A), (B)…", None),
    ("Inline lists", "General", "(a), (b)…", None),
    ("Inline lists", "General", "(1), (2)…", None),
]
