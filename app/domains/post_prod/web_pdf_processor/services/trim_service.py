import os
import fitz

def get_content_bbox(page):
    """
    Calculates the bounding box of all text, images, and drawings on a page.
    """
    rects = []
    
    # 1. Text blocks
    for block in page.get_text("blocks"):
        rects.append(fitz.Rect(block[:4]))
        
    # 2. Images
    for img_info in page.get_image_info():
        rects.append(fitz.Rect(img_info["bbox"]))
        
    # Note: We intentionally ignore drawings because printer crop marks 
    # and full-page bounding boxes are drawn as vectors, which ruins the auto-crop bounds.
    
    if not rects:
        return page.cropbox # If empty, return original
        
    # Calculate union of all bounding boxes
    union_rect = rects[0]
    for r in rects[1:]:
        union_rect |= r
        
    return union_rect

def trim_crop_engine(pdf_path, mode, margins=None, standardize_size=False, remove_marks=False, output_path=None):
    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"Error opening PDF: {e}")
        return False, str(e)
        
    print(f"Applying Trim / Crop Engine to '{pdf_path}'...")
    
    if output_path is None:
        base_name = os.path.splitext(pdf_path)[0]
        output_path = f"{base_name}_cropped.pdf"
        
    target_rects = []
    
    # Step 1: Calculate target rect for each page
    for page_num in range(len(doc)):
        page = doc[page_num]
        
        if mode == "auto":
            # Auto Fix: crop to actual content bounds with a small padding (e.g. 10 points)
            bbox = get_content_bbox(page)
            # Add 10pt padding around content, but don't exceed media box
            target = bbox + (-10, -10, 10, 10)
            target = target.intersect(page.mediabox)
            target_rects.append(target)
            
        elif mode == "fixed":
            # margins: top, right, bottom, left
            if not margins or len(margins) != 4:
                print("Error: Fixed mode requires exactly 4 margins (top right bottom left).")
                return False, "Fixed mode requires exactly 4 margins (top right bottom left)."
            top, right, bottom, left = margins
            
            # Start from MediaBox and apply margins inwards
            mb = page.mediabox
            target = fitz.Rect(mb.x0 + left, mb.y0 + top, mb.x1 - right, mb.y1 - bottom)
            target_rects.append(target)
            
        elif mode == "trimbox":
            target_rects.append(page.trimbox)
            
        elif mode == "bleedbox":
            target_rects.append(page.bleedbox)
            
        else:
            print(f"Error: Unknown mode '{mode}'")
            return False, f"Unknown mode '{mode}'"
            
    # Step 2: Standardize size if requested
    if standardize_size:
        # Find the maximum width and maximum height among all calculated crop boxes
        max_w = max(r.width for r in target_rects)
        max_h = max(r.height for r in target_rects)
        
        for i in range(len(target_rects)):
            r = target_rects[i]
            # Center the new standardized box around the original target box's center
            center = r.tl + (r.br - r.tl) / 2
            
            new_r = fitz.Rect(
                center.x - max_w / 2,
                center.y - max_h / 2,
                center.x + max_w / 2,
                center.y + max_h / 2
            )
            # Ensure we don't go outside the mediabox bounds
            page_mb = doc[i].mediabox
            
            # If standard box goes out of bounds, shift it
            if new_r.x0 < page_mb.x0:
                new_r.x1 += (page_mb.x0 - new_r.x0)
                new_r.x0 = page_mb.x0
            if new_r.y0 < page_mb.y0:
                new_r.y1 += (page_mb.y0 - new_r.y0)
                new_r.y0 = page_mb.y0
            if new_r.x1 > page_mb.x1:
                new_r.x0 -= (new_r.x1 - page_mb.x1)
                new_r.x1 = page_mb.x1
            if new_r.y1 > page_mb.y1:
                new_r.y0 -= (new_r.y1 - page_mb.y1)
                new_r.y1 = page_mb.y1
                
            target_rects[i] = new_r
            
    # Step 3: Apply the crop boxes and optional sanitization
    print("Applying calculated crop boxes...")
    for i in range(len(doc)):
        page = doc[i]
        rect = target_rects[i]
        
        # Ensure the underlying MediaBox is large enough to contain the new CropBox
        # If the standard size is larger than the original page, this automatically pads it!
        page.set_mediabox(page.mediabox | rect)
        
        # Set all boxes to effectively hide content outside the desired area
        page.set_cropbox(rect)
        page.set_trimbox(rect)
        page.set_bleedbox(rect)
        page.set_artbox(rect)
        
        if remove_marks:
            # Delete annotations that fall completely outside the new crop box
            for annot in page.annots():
                if not annot.rect.intersects(rect):
                    page.delete_annot(annot)
            # Clean content stream to merge/sanitize 
            page.clean_contents()
            
    num_pages = len(doc)
    doc.save(output_path, garbage=4, deflate=True) # garbage=4 aggressive optimization
    doc.close()
    
    print(f"✅ Successfully cropped {num_pages} pages.")
    print(f"Saved to: {output_path}")
    return True, output_path
