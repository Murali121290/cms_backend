// Re-export the unified toast system from components/ui
import { useToast } from '@/components/ui/useToast'

export const useToastStore = useToast

export const toast = {
  success: (msg: string) => useToast.getState().addToast({ title: msg, variant: 'success' }),
  error:   (msg: string) => useToast.getState().addToast({ title: msg, variant: 'error' }),
  info:    (msg: string) => useToast.getState().addToast({ title: msg, variant: 'info' }),
  warning: (msg: string) => useToast.getState().addToast({ title: msg, variant: 'warning' }),
}
