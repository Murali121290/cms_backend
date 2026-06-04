"""Generate a standalone HTML dashboard from technical scan results."""
from datetime import datetime
import json


def build_html_dashboard(scan_data: dict, filename: str) -> str:
    """
    Generate a standalone HTML dashboard from scan results.

    Args:
        scan_data: Full scan result dict from technical_editor_service.scan_errors()
        filename: Original file name for display

    Returns:
        Complete HTML string with embedded data and styling
    """
    meta = scan_data.get("meta", {})
    findings = scan_data.get("findings", [])
    spelling_summary = scan_data.get("spelling_summary", {})
    inconsistencies = scan_data.get("inconsistencies", [])
    stats = scan_data.get("stats", {})
    ia_report = scan_data.get("ia_report", {})
    category_totals = scan_data.get("category_totals", {})

    # Calculate category distribution
    categories = {}
    for finding in findings:
        cat = finding.get("category", "General")
        categories[cat] = categories.get(cat, 0) + 1

    total_findings = len(findings)
    chart_data = json.dumps({
        "labels": list(categories.keys()),
        "datasets": [
            {
                "data": list(categories.values()),
                "backgroundColor": [
                    "#3b82f6",  # Blue
                    "#f59e0b",  # Amber
                    "#10b981",  # Emerald
                    "#8b5cf6",  # Purple
                    "#ef4444",  # Red
                    "#6366f1",  # Indigo
                    "#6b7280",  # Gray
                ][:len(categories)],
            }
        ],
    })

    # Build findings table rows
    findings_html = ""
    for idx, f in enumerate(findings[:500], 1):  # Limit to first 500 for performance
        findings_html += f"""
    <tr>
      <td class="px-4 py-2 text-sm text-gray-600">{idx}</td>
      <td class="px-4 py-2 text-sm font-medium text-gray-800">{f.get("category", "")}</td>
      <td class="px-4 py-2 text-sm text-gray-700">{f.get("rule_label", "")}</td>
      <td class="px-4 py-2 text-sm font-mono text-gray-600">{f.get("surface", "")}</td>
      <td class="px-4 py-2 text-sm text-gray-600 max-w-xs truncate">{f.get("context", "")}</td>
      <td class="px-4 py-2 text-sm text-blue-600">{f.get("replacement", "—")}</td>
    </tr>
    """

    # Build spelling variants table
    spelling_html = ""
    if spelling_summary:
        spelling_html = f"""
    <div class="mt-6 grid grid-cols-2 gap-4">
      <div class="p-4 bg-blue-50 rounded-lg">
        <div class="text-sm font-semibold text-blue-900">US Variants</div>
        <div class="text-2xl font-bold text-blue-700">{spelling_summary.get("us", 0)}</div>
      </div>
      <div class="p-4 bg-red-50 rounded-lg">
        <div class="text-sm font-semibold text-red-900">UK Variants</div>
        <div class="text-2xl font-bold text-red-700">{spelling_summary.get("uk", 0)}</div>
      </div>
    </div>
    """

    # Build IA report table
    ia_rows_html = ""
    ia_rows = ia_report.get("rows", [])
    for row in ia_rows[:100]:  # Limit to first 100 rows
        element = row.get("element", "")
        subtype = row.get("subtype", "")
        pattern = row.get("pattern", "")
        total = row.get("total", 0)
        ia_rows_html += f"""
    <tr>
      <td class="px-4 py-2 text-sm font-medium text-gray-800">{element}</td>
      <td class="px-4 py-2 text-sm text-gray-700">{subtype}</td>
      <td class="px-4 py-2 text-sm text-gray-600">{pattern}</td>
      <td class="px-4 py-2 text-sm font-bold text-gray-800 text-center">{total}</td>
    </tr>
    """

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Technical Review Dashboard - {filename}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #f3f4f6;
            color: #1f2937;
        }}
        .container {{ max-width: 1200px; margin: 0 auto; padding: 2rem; }}
        h1, h2 {{ margin: 1.5rem 0 1rem 0; }}
        h1 {{ font-size: 2rem; color: #111827; }}
        h2 {{ font-size: 1.5rem; color: #374151; }}
        .cards {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }}
        .card {{
            background: white;
            border-radius: 0.5rem;
            padding: 1.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }}
        .card-value {{ font-size: 2.5rem; font-weight: bold; color: #2563eb; margin: 0.5rem 0; }}
        .card-label {{ font-size: 0.875rem; font-weight: 600; color: #6b7280; text-transform: uppercase; }}
        .chart-container {{
            background: white;
            border-radius: 0.5rem;
            padding: 1.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-bottom: 2rem;
            max-width: 400px;
        }}
        .table-container {{
            background: white;
            border-radius: 0.5rem;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-bottom: 2rem;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
        }}
        th {{
            background: #f9fafb;
            padding: 1rem;
            text-align: left;
            font-weight: 600;
            color: #374151;
            font-size: 0.875rem;
            border-bottom: 2px solid #e5e7eb;
        }}
        tr:hover {{ background: #f9fafb; }}
        .generated {{
            text-align: center;
            color: #9ca3af;
            font-size: 0.875rem;
            margin-top: 2rem;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Technical Review Dashboard</h1>
        <p style="color: #6b7280; margin-bottom: 2rem;"><strong>File:</strong> {filename}</p>

        <!-- Summary Cards -->
        <div class="cards">
            <div class="card">
                <div class="card-label">Total Findings</div>
                <div class="card-value">{total_findings}</div>
            </div>
            <div class="card">
                <div class="card-label">Inconsistencies</div>
                <div class="card-value">{len(inconsistencies)}</div>
            </div>
            <div class="card">
                <div class="card-label">Word Count</div>
                <div class="card-value">{stats.get("word_count", "—")}</div>
            </div>
            <div class="card">
                <div class="card-label">Missing Captions</div>
                <div class="card-value">{stats.get("missing_captions", 0)}</div>
            </div>
        </div>

        <!-- Category Distribution Chart -->
        {f'<div class="chart-container"><canvas id="categoryChart"></canvas></div>' if categories else ''}

        <!-- Spelling Variants -->
        {spelling_html}

        <!-- Findings Table -->
        <h2>All Findings ({min(total_findings, 500)})</h2>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Category</th>
                        <th>Rule</th>
                        <th>Surface</th>
                        <th>Context</th>
                        <th>Replacement</th>
                    </tr>
                </thead>
                <tbody>
                    {findings_html}
                </tbody>
            </table>
        </div>

        <!-- IA Report Table -->
        {f'''<h2>IA Report</h2>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Element</th>
                        <th>Subtype</th>
                        <th>Pattern</th>
                        <th style="text-align: center;">Count</th>
                    </tr>
                </thead>
                <tbody>
                    {ia_rows_html}
                </tbody>
            </table>
        </div>''' if ia_rows else ''}

        <div class="generated">Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</div>
    </div>

    <script>
        const ctx = document.getElementById('categoryChart');
        if (ctx) {{
            const data = {chart_data};
            new Chart(ctx, {{
                type: 'doughnut',
                data: data,
                options: {{
                    responsive: true,
                    plugins: {{
                        legend: {{ position: 'bottom' }}
                    }}
                }}
            }});
        }}
    </script>
</body>
</html>
"""
    return html
