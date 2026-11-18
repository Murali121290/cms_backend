/** @vitest-environment jsdom */
/**
 * UI contract tests for the Term Library page.
 *
 * Covers the two behaviours added alongside these tests:
 *
 *  1. **Multi-file upload fan-out** — the drawer's file input accepts
 *     multiple files; each is POSTed sequentially to the single-file
 *     backend endpoint via ``termListsApi.importExcel``; a per-file
 *     status row is rendered so a user can see which file succeeded
 *     and which failed; one file's error must not block the rest.
 *
 *  2. **Hard-delete confirmation dialog** — clicking the trash icon on
 *     a term-list card opens a confirm dialog that spells out what
 *     will be removed; clicking "Delete permanently" calls
 *     ``termListsApi.remove`` with the list's id; cancel closes the
 *     dialog without calling the API.
 *
 * Mocks target ``@/api/termListsApi`` only — real axios never fires.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Mock the API client surface the page talks to ──────────────────
vi.mock('@/api/termListsApi', () => {
  // The default import of ``termListsApi`` is a namespace object. Each
  // test resets implementations in ``beforeEach`` so one test's spy
  // behaviour never leaks into the next.
  return {
    termListsApi: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      importExcel: vi.fn(),
      downloadExcel: vi.fn(),
      terms: vi.fn(),
      addTerm: vi.fn(),
      updateTerm: vi.fn(),
      deleteTerm: vi.fn(),
      projectAssignment: vi.fn(),
      setProjectAssignment: vi.fn(),
      unassign: vi.fn(),
      viewProjectJson: vi.fn(),
      downloadProjectJson: vi.fn(),
      downloadProjectExcel: vi.fn(),
    },
  }
})

// RBAC hook — page gates the delete button on ``canEdit``.
vi.mock('@/hooks/useRBAC', () => ({
  useRBAC: () => ({ roles: ['Admin'] }),
}))
vi.mock('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))

import { termListsApi } from '@/api/termListsApi'
import { TermLibraryPage } from './TermLibraryPage'

const mockedApi = termListsApi as unknown as {
  list: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  importExcel: ReturnType<typeof vi.fn>
  terms: ReturnType<typeof vi.fn>
}

function termListFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    name: 'LWW Nursing Terms',
    description: null,
    scope: 'generic' as const,
    client_id: null,
    source_file: 'nursing.xlsx',
    term_count: 42,
    is_active: true,
    created_at: null,
    updated_at: null,
    assigned_project_ids: [],
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TermLibraryPage />
    </MemoryRouter>,
  )
}

async function waitForListRender(name: string) {
  await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument())
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.list.mockResolvedValue([termListFixture()])
  mockedApi.terms.mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] })
  mockedApi.importExcel.mockResolvedValue({
    term_list_id: 7,
    inserted: 3,
    skipped_duplicates_in_file: 0,
    skipped_already_present: 0,
    total_in_list: 3,
    sheets_scanned: ['Terms'],
    warnings: [],
  })
  mockedApi.remove.mockResolvedValue({ ok: true, deleted: { id: 7, name: 'LWW Nursing Terms', term_count: 42 } })
})


// ── Delete dialog ──────────────────────────────────────────────────

describe('TermLibraryPage · delete', () => {
  it('opens a confirmation dialog before deleting a list', async () => {
    renderPage()
    await waitForListRender('LWW Nursing Terms')

    // The delete icon on the card carries a stable testid.
    fireEvent.click(screen.getByTestId('termlist-delete-7'))

    // Dialog explains what will be removed (term count, cannot be undone).
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/42/)).toBeInTheDocument()
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument()
    expect(mockedApi.remove).not.toHaveBeenCalled()
  })

  it('cancelling the dialog does NOT call the delete API', async () => {
    renderPage()
    await waitForListRender('LWW Nursing Terms')

    fireEvent.click(screen.getByTestId('termlist-delete-7'))
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByTestId('delete-termlist-cancel'))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockedApi.remove).not.toHaveBeenCalled()
  })

  it('confirming the dialog calls remove with the list id and refreshes', async () => {
    renderPage()
    await waitForListRender('LWW Nursing Terms')

    fireEvent.click(screen.getByTestId('termlist-delete-7'))
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByTestId('delete-termlist-confirm'))

    await waitFor(() => expect(mockedApi.remove).toHaveBeenCalledWith(7))
    // list() is called once on mount and again after a successful delete
    // to refresh the grid.
    await waitFor(() => expect(mockedApi.list).toHaveBeenCalledTimes(2))
  })
})


// ── Multi-file upload ──────────────────────────────────────────────

/** Build a fake .xlsx-shaped File the input accepts. */
function xlsxFile(name: string, body = 'xlsx-bytes') {
  return new File([body], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** Open the detail drawer so the uploader is in the DOM. */
async function openDrawer() {
  fireEvent.click(screen.getByText('LWW Nursing Terms'))
  await waitFor(() => expect(screen.getByTestId('termlist-upload-input')).toBeInTheDocument())
}

describe('TermLibraryPage · multi-file upload', () => {
  it('accepts multiple files and exposes the native "multiple" attribute', async () => {
    renderPage()
    await waitForListRender('LWW Nursing Terms')
    await openDrawer()

    const input = screen.getByTestId('termlist-upload-input') as HTMLInputElement
    expect(input.multiple).toBe(true)
    expect(input.accept).toContain('.xlsx')
  })

  it('calls importExcel once per selected file and renders a per-file row', async () => {
    renderPage()
    await waitForListRender('LWW Nursing Terms')
    await openDrawer()

    const input = screen.getByTestId('termlist-upload-input') as HTMLInputElement
    const files = [xlsxFile('alpha.xlsx'), xlsxFile('beta.xlsx'), xlsxFile('gamma.xlsx')]
    fireEvent.change(input, { target: { files } })

    await waitFor(() => expect(mockedApi.importExcel).toHaveBeenCalledTimes(3))
    // All three files sent to the single-file endpoint (replace=false).
    expect(mockedApi.importExcel).toHaveBeenNthCalledWith(1, 7, files[0], false)
    expect(mockedApi.importExcel).toHaveBeenNthCalledWith(2, 7, files[1], false)
    expect(mockedApi.importExcel).toHaveBeenNthCalledWith(3, 7, files[2], false)

    // Per-file status rows.
    const list = await screen.findByTestId('termlist-upload-list')
    expect(within(list).getByText('alpha.xlsx')).toBeInTheDocument()
    expect(within(list).getByText('beta.xlsx')).toBeInTheDocument()
    expect(within(list).getByText('gamma.xlsx')).toBeInTheDocument()
  })

  it('one failing file does not block the others', async () => {
    renderPage()
    await waitForListRender('LWW Nursing Terms')
    await openDrawer()

    // Middle file fails; the fan-out must still finish the third.
    mockedApi.importExcel
      .mockResolvedValueOnce({ term_list_id: 7, inserted: 1, skipped_duplicates_in_file: 0, skipped_already_present: 0, total_in_list: 1, sheets_scanned: ['Terms'], warnings: [] })
      .mockRejectedValueOnce({ response: { data: { detail: 'Boom' } } })
      .mockResolvedValueOnce({ term_list_id: 7, inserted: 1, skipped_duplicates_in_file: 0, skipped_already_present: 0, total_in_list: 2, sheets_scanned: ['Terms'], warnings: [] })

    const input = screen.getByTestId('termlist-upload-input') as HTMLInputElement
    const files = [xlsxFile('ok1.xlsx'), xlsxFile('bad.xlsx'), xlsxFile('ok2.xlsx')]
    fireEvent.change(input, { target: { files } })

    await waitFor(() => expect(mockedApi.importExcel).toHaveBeenCalledTimes(3))

    const list = await screen.findByTestId('termlist-upload-list')
    const rows = within(list).getAllByTestId(/termlist-upload-row-\d+/)
    expect(rows).toHaveLength(3)

    // Pull status via the `data-status` attribute to prove the error
    // was isolated to the middle file.
    const statuses = rows.map((r) => r.getAttribute('data-status'))
    await waitFor(() => {
      expect(statuses.filter((s) => s === 'success').length + statuses.filter((s) => s === 'error').length)
        .toBeGreaterThan(0)
    })
    // After the microtasks settle, the final set should include the
    // middle-row error without preventing the other two from succeeding.
    await waitFor(() => {
      const current = within(list)
        .getAllByTestId(/termlist-upload-row-\d+/)
        .map((r) => r.getAttribute('data-status'))
      expect(current).toEqual(['success', 'error', 'success'])
    })
  })

  it('invalid extensions are rejected before hitting the API', async () => {
    renderPage()
    await waitForListRender('LWW Nursing Terms')
    await openDrawer()

    const input = screen.getByTestId('termlist-upload-input') as HTMLInputElement
    const bad = new File(['hi'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [bad] } })

    // Error toast surfaces; no API call issued.
    await waitFor(() => expect(screen.getByText(/notes\.txt/)).toBeInTheDocument())
    expect(mockedApi.importExcel).not.toHaveBeenCalled()
  })

  it('duplicate file picks are skipped client-side to avoid double import', async () => {
    renderPage()
    await waitForListRender('LWW Nursing Terms')
    await openDrawer()

    const input = screen.getByTestId('termlist-upload-input') as HTMLInputElement
    const f = xlsxFile('same.xlsx')
    fireEvent.change(input, { target: { files: [f, f] } })

    // Only the first copy is accepted; the second is rejected because
    // (name,size) already appears in the upload-row key set.
    await waitFor(() => expect(mockedApi.importExcel).toHaveBeenCalledTimes(1))
  })
})
