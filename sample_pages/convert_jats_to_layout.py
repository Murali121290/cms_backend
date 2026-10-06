import os
import re
from lxml import etree

xml_file = r"D:\cms_backend\data\cms_runtime_data\uploads\journals\JMIR-01\JR-001\articles\article_21\xml\10.1016_j.heliyon.2024.e24413_v3.xml"
output_html = r"D:\cms_backend\sample_pages\jats_layout_sample.html"
output_css = r"D:\cms_backend\sample_pages\jats_layout.css"

# Write JATS Layout CSS
css_content = """/* JATS XML to Layout HTML Custom Stylesheet */
:root {
  --primary-color: #0f4c81;
  --accent-color: #2563eb;
  --bg-color: #f8fafc;
  --card-bg: #ffffff;
  --text-main: #1e293b;
  --text-muted: #64748b;
  --border-color: #cbd5e1;
  --highlight-bg: #f0f9ff;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background-color: #0f172a;
  color: var(--text-main);
  line-height: 1.75;
  margin: 0;
  padding: 2rem 1rem;
}

.article-container {
  max-width: 980px;
  margin: 0 auto;
  background: var(--card-bg);
  padding: 3.5rem 4.5rem;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  border: 1px solid var(--border-color);
}

/* Journal Header */
.journal-banner {
  border-bottom: 2px solid var(--primary-color);
  padding-bottom: 1.2rem;
  margin-bottom: 2rem;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
}
.journal-title {
  font-size: 1.3rem;
  font-weight: 800;
  color: var(--primary-color);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.journal-meta-info {
  font-size: 0.8rem;
  color: var(--text-muted);
  text-align: right;
  font-weight: 500;
}

/* Article Category & Title */
.article-category {
  display: inline-block;
  background: #dbeafe;
  color: #1e40af;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  padding: 0.3rem 0.7rem;
  border-radius: 4px;
  margin-bottom: 1rem;
  letter-spacing: 0.5px;
}
.article-main-title {
  font-size: 2.1rem;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.3;
  margin-bottom: 1.5rem;
}

/* Authors & Affiliations */
.contrib-group {
  font-size: 1.05rem;
  font-weight: 600;
  color: #334155;
  margin-bottom: 1rem;
}
.aff-group {
  font-size: 0.85rem;
  color: var(--text-muted);
  background: #f1f5f9;
  padding: 1rem 1.4rem;
  border-radius: 8px;
  margin-bottom: 2.5rem;
  line-height: 1.6;
  border-left: 3px solid #94a3b8;
}

/* Abstract & Keywords */
.abstract-card {
  background: var(--highlight-bg);
  border-left: 4px solid var(--accent-color);
  padding: 1.8rem;
  border-radius: 0 8px 8px 0;
  margin-bottom: 2.5rem;
}
.abstract-card h3 {
  margin-top: 0;
  font-size: 1.05rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--primary-color);
  letter-spacing: 0.5px;
  margin-bottom: 0.8rem;
}
.abstract-card p {
  font-size: 0.95rem;
  color: #334155;
  margin-bottom: 1rem;
}
.kwd-group {
  margin-top: 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.kwd-tag {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  color: #334155;
  font-size: 0.78rem;
  padding: 0.25rem 0.7rem;
  border-radius: 14px;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

/* Section Headings */
.sec-title {
  font-size: 1.4rem;
  font-weight: 800;
  color: #0f172a;
  border-bottom: 2px solid #e2e8f0;
  padding-bottom: 0.4rem;
  margin-top: 2.5rem;
  margin-bottom: 1.2rem;
}
.subsec-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: #1e293b;
  margin-top: 1.8rem;
  margin-bottom: 0.9rem;
}

/* Paragraphs & In-Text Citations */
p {
  margin-bottom: 1.3rem;
  text-align: justify;
  font-size: 0.98rem;
  color: #334155;
}
.xref-bibr, .xref-fig {
  color: var(--accent-color);
  font-weight: 600;
  text-decoration: none;
  background: #eff6ff;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  border: 1px solid #bfdbfe;
  transition: all 0.2s;
}
.xref-bibr:hover, .xref-fig:hover {
  background: #dbeafe;
}

/* Figures */
.fig-container {
  background: #f8fafc;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1.5rem;
  margin: 2.5rem 0;
  text-align: center;
}
.fig-label {
  font-size: 1rem;
  font-weight: 800;
  color: var(--primary-color);
  margin-bottom: 0.8rem;
  display: block;
}
.fig-caption {
  font-size: 0.9rem;
  color: #475569;
  text-align: left;
  margin-top: 1rem;
  line-height: 1.6;
  background: #ffffff;
  padding: 0.8rem 1rem;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}
.fig-image-placeholder {
  background: #e2e8f0;
  border: 2px dashed #94a3b8;
  height: 260px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #475569;
  font-weight: 700;
  font-size: 0.95rem;
  border-radius: 6px;
}

/* References List */
.ref-list {
  list-style: none;
  padding-left: 0;
  margin-top: 1.5rem;
}
.ref-item {
  margin-bottom: 1rem;
  font-size: 0.9rem;
  line-height: 1.6;
  display: flex;
  gap: 0.8rem;
  background: #f8fafc;
  padding: 0.8rem 1rem;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}
.ref-num {
  font-weight: 800;
  color: var(--primary-color);
  min-width: 24px;
}
.ref-text {
  color: #334155;
}
"""

with open(output_css, "w", encoding="utf-8") as f:
    f.write(css_content)

# Parse XML
tree = etree.parse(xml_file)
root = tree.getroot()

def get_node_text(elem):
    if elem is None:
        return ""
    text = etree.tostring(elem, encoding="utf-8", method="text").decode("utf-8")
    return re.sub(r'\s+', ' ', text).strip()

journal_title = root.findtext(".//journal-title-group/journal-title") or "Journal Article"
publisher = root.findtext(".//publisher/publisher-name") or ""
issn_pub = root.findtext(".//issn[@pub-type='epub']") or root.findtext(".//issn") or ""
doi = root.findtext(".//article-meta/article-id[@pub-id-type='doi']") or ""
category = root.findtext(".//subj-group[@subj-group-type='heading']/subject") or "Case report"
title = root.findtext(".//article-title") or ""

# Authors
authors = []
for contrib in root.findall(".//contrib[@contrib-type='author']"):
    name = contrib.find("name")
    if name is not None:
        surname = name.findtext("surname") or ""
        given = name.findtext("given-names") or ""
        if surname or given:
            authors.append(f"{given} {surname}".strip())

aff = root.findtext(".//aff") or ""
abstract_node = root.find(".//abstract")
abstract_text = get_node_text(abstract_node)
keywords = [k.text for k in root.findall(".//kwd-group/kwd") if k.text]

body_html = []
body_el = root.find("body")

def render_element(elem):
    tag = elem.tag
    if tag == "sec":
        html = []
        sec_title = elem.find("title")
        if sec_title is not None:
            parent = elem.getparent()
            is_subsec = parent is not None and parent.tag == "sec"
            title_class = "subsec-title" if is_subsec else "sec-title"
            html.append(f'<h2 class="{title_class}">{sec_title.text}</h2>')
        for child in elem:
            if child.tag != "title":
                html.append(render_element(child))
        return "".join(html)
    elif tag == "p":
        p_html = etree.tostring(elem, encoding="utf-8", method="html").decode("utf-8")
        p_html = re.sub(r'<xref\s+[^>]*ref-type="bibr"[^>]*>(.*?)</xref>', r'<a class="xref-bibr" href="#\1">\1</a>', p_html)
        p_html = re.sub(r'<xref\s+[^>]*ref-type="fig"[^>]*>(.*?)</xref>', r'<span class="xref-fig">\1</span>', p_html)
        p_html = re.sub(r'<named-content\s+[^>]*content-type="bold"[^>]*>(.*?)</named-content>', r'<b>\1</b>', p_html)
        p_html = re.sub(r'<named-content\s+[^>]*>(.*?)</named-content>', r'\1', p_html)
        return p_html
    elif tag == "fig":
        fig_label = elem.findtext("label") or "Figure"
        caption_node = elem.find("caption")
        caption_text = get_node_text(caption_node)
        graphic = elem.find("graphic")
        href = graphic.get("{http://www.w3.org/1999/xlink}href") if graphic is not None else ""
        return f'''
        <div class="fig-container" id="{elem.get("id", "")}">
          <span class="fig-label">{fig_label}</span>
          <div class="fig-image-placeholder">
            🖼 Figure Artwork: {href}
          </div>
          <div class="fig-caption"><b>{fig_label}:</b> {caption_text}</div>
        </div>
        '''
    return ""

if body_el is not None:
    for child in body_el:
        body_html.append(render_element(child))

# References
ref_items_html = []
for ref in root.findall(".//ref-list/ref"):
    ref_id = ref.get("id", "")
    label = ref.findtext("label") or ""
    elem_cite = ref.find("element-citation")
    ref_str = get_node_text(elem_cite)
    ref_items_html.append(f'''
    <li class="ref-item" id="{ref_id}">
      <span class="ref-num">{label}.</span>
      <span class="ref-text">{ref_str}</span>
    </li>
    ''')

# Assemble Layout HTML Page
html_page = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <link rel="stylesheet" href="jats_layout.css">
</head>
<body>
  <div class="article-container">
    
    <!-- Journal Banner Header -->
    <header class="journal-banner">
      <div>
        <div class="journal-title">{journal_title}</div>
        <div style="font-size: 0.8rem; color: #64748b;">Publisher: {publisher}</div>
      </div>
      <div class="journal-meta-info">
        <div>eISSN: {issn_pub}</div>
        <div>DOI: {doi}</div>
      </div>
    </header>

    <!-- Category & Main Title -->
    <div class="article-category">{category}</div>
    <h1 class="article-main-title">{title}</h1>

    <!-- Authors & Affiliations -->
    <div class="contrib-group">
      {", ".join(authors)}
    </div>
    <div class="aff-group">
      <b>Affiliations:</b> {aff}
    </div>

    <!-- Abstract & Keywords -->
    <div class="abstract-card">
      <h3>Abstract</h3>
      <p>{abstract_text}</p>
      <div class="kwd-group">
        {"".join([f'<span class="kwd-tag">{k}</span>' for k in keywords])}
      </div>
    </div>

    <!-- Article Body -->
    <main>
      {"".join(body_html)}
    </main>

    <!-- References -->
    <section>
      <h2 class="sec-title">References</h2>
      <ul class="ref-list">
        {"".join(ref_items_html)}
      </ul>
    </section>

  </div>
</body>
</html>
'''

with open(output_html, "w", encoding="utf-8") as f:
    f.write(html_page)

print("Regenerated JATS Layout HTML sample with complete abstract and figure captions!")
