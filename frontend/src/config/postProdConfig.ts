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
    id: 'ppt-formatter',
    title: 'PPT Formatter',
    description: 'Format, style, and structure slide decks using automated layouts and template compliance checks.',
    icon: 'Layers',
    enabled: true,
    externalUrl: 'http://10.1.1.18:5050/',
  },
  {
    id: 'web-pdf-processor',
    title: 'Web PDF Processor',
    description: 'Process and enhance Web PDFs with bookmarks, hyperlinks, page setup, cover pages, and publication-ready formatting.',
    icon: 'FileCog',
    enabled: false,
  }
];
