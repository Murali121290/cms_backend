import { useSearchParams } from 'react-router-dom'

export type BookReviewKind = 'structuring' | 'technical' | 'language'

/**
 * Journal mode for the book review pages (Structuring / Technical / Language).
 *
 * A journal article opens those pages on its shadow book file with
 * `?journalArticle=<id>&journal=<journalId>`. There is no book chapter then, so "Back"
 * returns to the journal article, in-page links stay on the journal review routes, and
 * the Technical page's stylesheet link goes to the journal's IA rules settings.
 */
export function useJournalReviewMode() {
  const [params] = useSearchParams()
  const articleId = Number(params.get('journalArticle'))
  if (!Number.isInteger(articleId) || articleId <= 0) return null
  const journalId = Number(params.get('journal')) || null
  return {
    articleId,
    journalId,
    backHref: `/journal-article-editor/${articleId}`,
    backLabel: 'Back to Article',
    iaRulesHref: journalId ? `/journal-production/journals/${journalId}/settings#ia` : `/journal-article-editor/${articleId}`,
    reviewHref: (kind: BookReviewKind, projectId: number, fileId: number, tab?: string) =>
      `${journalReviewPath(kind, projectId, fileId, articleId, journalId)}${tab ? `&tab=${tab}` : ''}`,
  }
}

export const journalReviewPath = (kind: BookReviewKind, projectId: number, fileId: number, articleId: number, journalId?: number | null) =>
  `/journal-production/review/${kind}/${projectId}/${fileId}?journalArticle=${articleId}${journalId ? `&journal=${journalId}` : ''}`
