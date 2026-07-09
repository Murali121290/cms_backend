import { toast } from '@/store/useToastStore'

export async function openInWordWithFallback(fileId: number, filename: string) {
  try {
    const res = await fetch(`/api/v2/files/${fileId}/open-in-word`)
    const data = await res.json()
    if (!data?.ms_word_uri) return
    window.location.href = data.ms_word_uri
  } catch {
    toast.error(`Failed to launch Word for ${filename}`)
  }
}
