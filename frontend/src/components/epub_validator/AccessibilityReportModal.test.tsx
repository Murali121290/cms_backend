import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccessibilityReportModal } from './AccessibilityReportModal';
import type { AceReport } from '@/types/epubValidator';

const report: AceReport = {
  status: 'fail',
  ran_at: '2026-08-04T10:00:00.000Z',
  duration_seconds: 12,
  conformance_level: 'A',
  totals: { critical: 1, serious: 0, moderate: 0, minor: 0 },
  metadata: {
    title: 'Sample Book',
    language: 'en',
    identifier: 'sample-id',
    accessibility_features: ['MathML'],
    accessibility_summary: null,
    conforms_to: ['EPUB Accessibility 1.1 - WCAG 2.2 Level AA'],
  },
  violations: [],
  coverage: {
    files_checked: 1,
    images_inspected: 1,
    images_missing_alt: 0,
    accessibility_metadata_missing: [],
    accessibility_metadata_empty: [],
    outline_summary: { toc_entries: 1, headings: 3 },
  },
};

describe('AccessibilityReportModal', () => {
  it('renders a download link for the DAISY ACE report', () => {
    render(<AccessibilityReportModal report={report} folderName="sample-book" onClose={() => {}} />);

    const link = screen.getByRole('link', { name: /download report/i });
    expect(link).toHaveAttribute('href', '/api/v2/post-prod/epub-validator/ace/sample-book/report/report.html');
    expect(link).toHaveAttribute('download', 'sample-book-ace-report.html');
  });
});
