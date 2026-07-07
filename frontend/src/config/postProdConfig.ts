export interface PostProdService {
  id: string;
  title: string;
  description: string;
  icon: string; // Lucide icon name or identifier
  enabled: boolean;
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
    enabled: false,
  },
  {
    id: 'pdf-extractor',
    title: 'PDF Structural Extractor',
    description: 'Extract tables, figures, metadata, and body text elements from standard PDFs.',
    icon: 'Download',
    enabled: false,
  }
];
