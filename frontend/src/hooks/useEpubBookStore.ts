import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getBooks, deleteBook as deleteBookApi } from '../api/epubValidator';
import type { Book } from '../types/epubValidator';

export function useEpubBookStore() {
  const queryClient = useQueryClient();

  const { data: books = [], isLoading, refetch } = useQuery<Book[]>({
    queryKey: ['epub-books'],
    queryFn: getBooks,
    staleTime: 30_000,
  });

  const upsertBook = (_book: Book) => {
    queryClient.invalidateQueries({ queryKey: ['epub-books'] });
  };

  const deleteBook = async (folderName: string) => {
    await deleteBookApi(folderName);
    queryClient.invalidateQueries({ queryKey: ['epub-books'] });
  };

  return { books, isLoading, refetch, upsertBook, deleteBook };
}
