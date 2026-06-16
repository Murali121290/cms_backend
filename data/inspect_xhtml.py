import os
import re
from app.processing.docx_to_xhtml_runs import DocxToXhtmlRunsEngine

def main():
    path = "/opt/cms_runtime/data/uploads/Edwards_188327/4/Manuscript/Abuhamad9781975242831-ch002-Tagged_Results/Abuhamad9781975242831-ch002-Tagged_Processed.docx"
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return
        
    engine = DocxToXhtmlRunsEngine()
    html = engine.convert(path)
    
    # Simple regex to extract paragraphs/lists with data-para-idx
    pattern = re.compile(r'<([^ >]+)[^>]*class="([^"]+)"[^>]*data-para-idx="(\d+)"[^>]*>(.*?)</\1>', re.DOTALL)
    
    print("Blocks with data-para-idx:")
    for match in pattern.finditer(html):
        tag, style, para_idx, content = match.groups()
        # strip inner tags for text
        text = re.sub(r'<[^>]+>', '', content).strip()
        print(f"data-para-idx: {para_idx} | Tag: {tag} | Style: {style} | Text: {text[:60]}")

if __name__ == '__main__':
    main()
