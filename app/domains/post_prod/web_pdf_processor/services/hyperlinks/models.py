"""
Data models and type definitions for PDF URL & Hyperlink Processing.
"""
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any


@dataclass
class DetectedUrl:
    """Represents a URL detected in the PDF text (single-line or multi-line)."""
    raw_text: str  # Original raw text exactly as extracted from PDF
    reconstructed_url: str  # Cleaned, stitched, normalized URL
    page: int  # 1-based physical page number
    page_idx: int  # 0-based page index
    is_multiline: bool = False
    line_count: int = 1
    segments: List[str] = field(default_factory=list)  # Text segment on each line
    rects: List[List[float]] = field(default_factory=list)  # [x0, y0, x1, y1] for each line segment
    primary_rect: Optional[List[float]] = None  # Enclosing or primary bounding box


@dataclass
class LinkAnnotationInfo:
    """Represents an existing PDF hyperlink annotation extracted from the document."""
    page: int  # 1-based physical page number
    page_idx: int  # 0-based page index
    kind: int  # PyMuPDF link kind (e.g. LINK_URI=2, LINK_GOTO=1)
    kind_name: str  # 'URI', 'GOTO', etc.
    uri: Optional[str] = None  # Destination URI for external links
    target_page: Optional[int] = None  # Target page for internal links
    rect: Optional[List[float]] = None  # [x0, y0, x1, y1]
    visible_text: str = ""  # Visible text on page covered by rect
    is_external: bool = False
    is_malformed: bool = False
    xref: Optional[int] = None
    link_id: Optional[str] = None


@dataclass
class UrlValidationResult:
    """Result of syntax, SSRF, DNS, and HTTP reachability validation."""
    url: str
    is_valid: bool  # Syntax and network validity
    status: str  # 'Valid', 'Broken', 'Redirected', 'Invalid', 'Unreachable', 'Access Restricted', 'Timeout', 'SSL Error', 'Manual Review'
    http_status: Optional[int] = None
    http_description: str = ""
    is_ok: bool = False  # HTTP status < 400 or valid
    final_url: Optional[str] = None  # Destination after redirects
    redirect_chain: List[str] = field(default_factory=list)
    error_detail: Optional[str] = None
    is_ssrf_blocked: bool = False


@dataclass
class ProcessedHyperlinkItem:
    """Unified representation of a detected URL / annotation on a page."""
    page: int
    page_idx: int
    original_text: str  # Exact text extracted from PDF
    reconstructed_url: str  # Normalized continuous URL
    annotation_dest: Optional[str] = None  # Destination URI from PDF annotation if linked
    is_linked: bool = False  # Whether it is hyperlinked in PDF
    is_multiline: bool = False
    line_count: int = 1
    rect: Optional[List[float]] = None  # Primary bounding box
    all_rects: List[List[float]] = field(default_factory=list)  # Bounding boxes for each line
    segments: List[str] = field(default_factory=list)
    
    # Validation
    validation_status: str = "Unknown"  # 'Valid', 'Broken', 'Redirected', 'Invalid', etc.
    http_status: Optional[int] = None
    http_description: str = ""
    http_ok: bool = False
    final_url: Optional[str] = None
    
    # Issues & Correction Status
    issue_type: Optional[str] = None  # 'missing_annotation', 'mismatch', 'malformed_target', 'multiline_broken', 'duplicate', 'broken_destination'
    correction_suggestion: Optional[str] = None
    correction_status: str = "none"  # 'none', 'corrected', 'manual_review', 'verified'
    error_description: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict matching frontend UrlLinkDetail and reporting requirements."""
        return {
            "page": self.page,
            "page_idx": self.page_idx,
            "url": self.annotation_dest or self.reconstructed_url,
            "display_text": self.original_text,
            "original_text": self.original_text,
            "reconstructed_url": self.reconstructed_url,
            "annotation_dest": self.annotation_dest,
            "is_linked": self.is_linked,
            "is_multiline": self.is_multiline,
            "line_count": self.line_count,
            "rect": self.rect,
            "all_rects": self.all_rects,
            "segments": self.segments,
            "http_status": self.http_status,
            "http_description": self.http_description,
            "http_ok": self.http_ok,
            "validation_status": self.validation_status,
            "final_url": self.final_url,
            "issue_type": self.issue_type,
            "correction_suggestion": self.correction_suggestion,
            "correction_status": self.correction_status,
            "error_description": self.error_description,
        }
