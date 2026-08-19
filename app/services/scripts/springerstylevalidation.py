# -*- coding: utf-8 -*-
import argparse
import json
import sys
import os
import html
from docx import Document

def generate_html_report(docx_path, json_config_path, output_html_path):
    # 1. Load JSON configuration (Springer Styles)
    try:
        with open(json_config_path, 'r', encoding='utf-8') as f:
            rules = json.load(f)
    except Exception as e:
        print(f"[ERROR] Failed to load JSON configuration file: {e}")
        sys.exit(1)

    if isinstance(rules, list):
        allowed_styles = set(rules)
    else:
        allowed_styles = set(rules.get("allowed_styles", []))

    # 2. Open Edited Word Document
    try:
        doc = Document(docx_path)
    except Exception as e:
        print(f"[ERROR] Failed to open Word document: {e}")
        sys.exit(1)

    used_styles = set()
    style_locations = {}

    def track_style_location(style_name, location_str):
        if style_name not in style_locations:
            style_locations[style_name] = []
        style_locations[style_name].append(location_str)

    def get_style_name(style_obj):
        if style_obj and hasattr(style_obj, 'name') and style_obj.name:
            return style_obj.name
        return "[Unset Style]"

    # 3. Styles only from Active Paragraphs (Content in use word document)
    for i, p in enumerate(doc.paragraphs, start=1):
        # Paragraph style actually applied in text
        style_name = get_style_name(p.style)
        used_styles.add(style_name)
        track_style_location(style_name, f"Paragraph {i}")

        # Character styles actively applied to text runs
        for r_idx, run in enumerate(p.runs, start=1):
            if run.style and run.style.name and run.style.name != "Default Paragraph Font":
                run_style_name = run.style.name
                used_styles.add(run_style_name)
                track_style_location(run_style_name, f"Paragraph {i}, Run {r_idx}")

    # 4. Scan ONLY Active Tables (Content in use word document)
    for t_idx, table in enumerate(doc.tables, start=1):
        table_style = get_style_name(table.style)
        used_styles.add(table_style)
        track_style_location(table_style, f"Table {t_idx}")

    # Deduplicate and separate unique style lists
    all_unique_styles = sorted(list(used_styles), key=lambda x: str(x))
    unauthorized_styles = sorted([s for s in used_styles if s not in allowed_styles], key=lambda x: str(x))
    allowed_used_styles = sorted([s for s in used_styles if s in allowed_styles], key=lambda x: str(x))

    status_pass = len(unauthorized_styles) == 0

    # 5. Build Responsive HTML Document
    html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Word Document Style Validation Report</title>
    <style>
        :root {{
            --bg-color: #f8fafc;
            --card-bg: #ffffff;
            --text-main: #1e293b;
            --text-muted: #64748b;
            --border-color: #e2e8f0;
            --pass-color: #10b981;
            --pass-bg: #ecfdf5;
            --fail-color: #ef4444;
            --fail-bg: #fef2f2;
        }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            margin: 0;
            padding: 40px 20px;
            line-height: 1.5;
        }}
        .container {{ max-width: 960px; margin: 0 auto; }}
        .header {{
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 28px 32px;
            margin-bottom: 24px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }}
        .header h1 {{ margin: 0 0 12px 0; font-size: 24px; }}
        .meta-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 12px;
            margin-top: 16px;
            font-size: 14px;
        }}
        .meta-item {{ background: #f1f5f9; padding: 10px 14px; border-radius: 8px; }}
        .meta-label {{
            color: var(--text-muted);
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
            font-weight: 600;
        }}
        .meta-val {{ font-weight: 600; word-break: break-all; }}
        .status-banner {{
            display: inline-block;
            padding: 6px 16px;
            border-radius: 20px;
            font-weight: 700;
            font-size: 14px;
            margin-top: 8px;
        }}
        .status-pass {{ background-color: var(--pass-bg); color: var(--pass-color); border: 1px solid #a7f3d0; }}
        .status-fail {{ background-color: var(--fail-bg); color: var(--fail-color); border: 1px solid #fecaca; }}
        .card {{
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 24px 32px;
            margin-bottom: 24px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }}
        .card-title {{
            font-size: 18px;
            font-weight: 700;
            margin-top: 0;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }}
        .badge {{ font-size: 12px; padding: 4px 10px; border-radius: 12px; font-weight: 600; }}
        .badge-fail {{ background: var(--fail-bg); color: var(--fail-color); }}
        .badge-pass {{ background: var(--pass-bg); color: var(--pass-color); }}
        table {{ width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 14px; }}
        th, td {{ text-align: left; padding: 12px 16px; border-bottom: 1px solid var(--border-color); vertical-align: top; }}
        th {{ background-color: #f8fafc; color: var(--text-muted); font-weight: 600; font-size: 13px; text-transform: uppercase; }}
        tr:last-child td {{ border-bottom: none; }}
        .style-tag {{ font-family: monospace; font-size: 13px; padding: 4px 8px; border-radius: 4px; font-weight: 600; display: inline-block; }}
        .tag-unauthorized {{ background-color: #fef2f2; color: #dc2626; border: 1px solid #fca5a5; }}
        .tag-authorized {{ background-color: #f0fdf4; color: #16a34a; border: 1px solid #86efac; }}
        .location-pills {{ display: flex; flex-wrap: wrap; gap: 6px; }}
        .pill {{ background-color: #f1f5f9; color: #475569; font-size: 12px; padding: 2px 8px; border-radius: 4px; border: 1px solid #e2e8f0; }}
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <h1>Word Style Validation Report (In-Use Only)</h1>
            <div class="status-banner {"status-pass" if status_pass else "status-fail"}">
                {"VALIDATION PASSED" if status_pass else "UNAUTHORIZED STYLES DETECTED"}
            </div>
            <div class="meta-grid">
                <div class="meta-item">
                    <div class="meta-label">Document Name</div>
                    <div class="meta-val">{html.escape(os.path.basename(docx_path))}</div>
                </div>
                <div class="meta-item">
                    <div class="meta-label">Config Rules</div>
                    <div class="meta-val">{html.escape(os.path.basename(json_config_path))}</div>
                </div>
                <div class="meta-item">
                    <div class="meta-label">Unique Styles In-Use</div>
                    <div class="meta-val">{len(all_unique_styles)}</div>
                </div>
                <div class="meta-item">
                    <div class="meta-label">Unauthorized Styles In-Use</div>
                    <div class="meta-val" style="color: {"#ef4444" if len(unauthorized_styles)>0 else "#10b981"}">
                        {len(unauthorized_styles)}
                    </div>
                </div>
            </div>
        </div>

        <!-- Section 1: Unauthorized Unique Styles In-Use -->
        <div class="card">
            <div class="card-title">
                <span>Unauthorized Unique Styles (Active in Content)</span>
                <span class="badge badge-fail">{len(unauthorized_styles)} Issues</span>
            </div>
"""

    if unauthorized_styles:
        html_doc += """
            <table>
                <thead>
                    <tr>
                        <th style="width: 30%;">Unique Style Name</th>
                        <th style="width: 15%;">Active Usage</th>
                        <th style="width: 55%;">Locations Found</th>
                    </tr>
                </thead>
                <tbody>
"""
        for style_name in unauthorized_styles:
            locs = style_locations.get(style_name, [])
            loc_count = len(locs)
            
            max_pills = 15
            pills_html = "".join([f'<span class="pill">{html.escape(loc)}</span>' for loc in locs[:max_pills]])
            if loc_count > max_pills:
                pills_html += f'<span class="pill" style="background:#e2e8f0; font-weight:600;">+{loc_count - max_pills} more...</span>'

            html_doc += f"""
                    <tr>
                        <td>
                            <span class="style-tag tag-unauthorized">{html.escape(str(style_name))}</span>
                        </td>
                        <td><strong>{loc_count}</strong> times</td>
                        <td>
                            <div class="location-pills">{pills_html}</div>
                        </td>
                    </tr>
"""
        html_doc += """
                </tbody>
            </table>
"""
    else:
        html_doc += """
            <p style="color: var(--pass-color); font-weight: 600; margin: 0;">
                No unauthorized styles are actively used in this document!
            </p>
"""

    html_doc += f"""
        </div>

        <!-- Section 2: Approved Unique Styles In-Use -->
        <div class="card">
            <div class="card-title">
                <span>Approved Unique Styles (Active in Content)</span>
                <span class="badge badge-pass">{len(allowed_used_styles)} Valid Styles</span>
            </div>
"""

    if allowed_used_styles:
        html_doc += """
            <table>
                <thead>
                    <tr>
                        <th style="width: 35%;">Unique Style Name</th>
                        <th style="width: 20%;">Active Usage</th>
                        <th style="width: 45%;">Sample Occurrences</th>
                    </tr>
                </thead>
                <tbody>
"""
        for style_name in allowed_used_styles:
            locs = style_locations.get(style_name, [])
            loc_count = len(locs)
            sample_pills = "".join([f'<span class="pill">{html.escape(loc)}</span>' for loc in locs[:5]])
            if loc_count > 5:
                sample_pills += f'<span class="pill" style="background:#e2e8f0;">+{loc_count - 5} more</span>'

            html_doc += f"""
                    <tr>
                        <td>
                            <span class="style-tag tag-authorized">{html.escape(str(style_name))}</span>
                        </td>
                        <td>{loc_count} times</td>
                        <td>
                            <div class="location-pills">{sample_pills}</div>
                        </td>
                    </tr>
"""
        html_doc += """
                </tbody>
            </table>
"""
    else:
        html_doc += """
            <p style="color: var(--text-muted); margin: 0;">No allowed styles were actively matched in document content.</p>
"""

    html_doc += """
        </div>
    </div>
</body>
</html>
"""

    # Save HTML output
    try:
        with open(output_html_path, 'w', encoding='utf-8') as f:
            f.write(html_doc)
        print(f"[SUCCESS] In-use HTML report saved to: {output_html_path}")
        return 0 if status_pass else 1
    except Exception as e:
        print(f"[ERROR] Failed to save HTML report file: {e}")
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Validate in-use Word document (.docx) styles against allowed JSON list."
    )
    parser.add_argument("-d", "--doc", required=True, help="Path to the Word document (.docx)")
    parser.add_argument("-c", "--config", required=True, help="Path to allowed styles JSON file")
    parser.add_argument("-o", "--output", default="style_report.html", help="Path for output HTML report")

    args = parser.parse_args()
    exit_code = generate_html_report(args.doc, args.config, args.output)
    sys.exit(exit_code)