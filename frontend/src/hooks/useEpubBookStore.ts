/**
 * Thin compatibility shim — the workspace page (PostProdEpubValidatorFiles)
 * uses this hook to look up a book's metadata by folder_name.
 * It now fetches from the new /projects endpoint instead of the removed /books endpoint.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listProjects, deleteProject as deleteProjectApi, type EvProject } from '../api/epubValidator';
import type { Book } from '../types/epubValidator';

function projectToBook(p: EvProject): Book {
  return {
    folder_name: p.folder_name,
    epub_path: p.epub_path,
    uploaded_at: p.uploaded_at,
    total_files: p.total_files,
  };
}

export function useEpubBookStore() {
  const queryClient = useQueryClient();

  const { data: projects = [], isLoading, refetch } = useQuery<EvProject[]>({
    queryKey: ['epub-books'],
    queryFn: listProjects,
    staleTime: 30_000,
  });

  const books: Book[] = projects.map(projectToBook);

  // upsertBook is a no-op — list is now server-driven.
  const upsertBook = (_book: Book) => {
    queryClient.invalidateQueries({ queryKey: ['epub-books'] });
  };

  // deleteBook by folder_name — look up project id then delete.
  const deleteBook = async (folderName: string) => {
    const project = projects.find((p) => p.folder_name === folderName);
    if (project) {
      await deleteProjectApi(project.id);
      queryClient.invalidateQueries({ queryKey: ['epub-books'] });
    }
  };

  return { books, isLoading, refetch, upsertBook, deleteBook };
}
