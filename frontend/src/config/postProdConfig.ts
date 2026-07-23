export interface PostProdService {
  id: string;
  title: string;
  description: string;
  icon: string; // Lucide icon name or identifier
  enabled: boolean;
  externalUrl?: string; // If set, opens this URL in a new tab instead of in-app navigation
}

export const POST_PROD_SERVICES: PostProdService[] = [
  {
    id: 'word-conversion',
    title: 'Word Conversion',
    description: 'Convert InDesign package files (.indd) or PDF files directly to structured DOCX manuscripts.',
    icon: 'FileText',
    enabled: true,
  },
  {
    id: 'slide-formatter',
    title: 'SlideFormatter',
    description: 'Format, style, and structure slide decks using automated layouts and template compliance checks.',
    icon: 'Layers',
    enabled: true,
  },
  {
    id: 'web-pdf-processor',
    title: 'Web PDF Processor',
    description: 'Process and enhance Web PDFs with bookmarks, hyperlinks, page setup, cover pages, and publication-ready formatting.',
    icon: 'FileCog',
    enabled: false,
  },
  {
    id: 'epub-css-matcher',
    title: 'EPUB CSS Matcher',
    description: 'Verify EPUB embedded stylesheets against master templates and identify CSS differences, encoding issues, and validation errors.',
    icon: 'BookOpen',
    enabled: true,
  },
  {
    id: 'epub-validator',
    title: 'EPUB Validator',
    description: 'Upload ZIP packages, run comprehensive XHTML checks, edit markup/CSS in the browser, check PDF parity, and export clean EPUBs.',
    icon: 'FileCheck',
    enabled: true,
  }
];
