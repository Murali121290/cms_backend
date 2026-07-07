import { toast } from '@/store/useToastStore'

// The ms-word:ofe|u| protocol handoff can fail silently — no registered
// handler, or (more commonly on Mac, especially from Chrome) a flaky
// launch. If the tab hasn't lost focus a couple of seconds after we
// navigate to it, assume Word didn't open and fall back to a direct
// download instead of leaving the user stuck with nothing.
export async function openInWordWithFallback(fileId: number, filename: string) {
  try {
    const res = await fetch(`/api/v2/files/${fileId}/open-in-word`)
    const data = await res.json()
    if (!data?.ms_word_uri) return
    window.location.href = data.ms_word_uri
    setTimeout(() => {
      if (document.visibilityState === 'visible') {
        toast.info(`Word didn't open — downloading ${filename} instead.`)
        const a = document.createElement('a')
        a.href = `/api/v2/files/${fileId}/download`
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
    }, 2000)
  } catch {
    // silently ignore; browser will show no handler error if Word not installed
  }
}
