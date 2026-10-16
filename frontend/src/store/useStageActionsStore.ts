import { create } from 'zustand'
import { stagesApi, ProcessingActionDefinition } from '@/api/stages'
import { setDynamicStageActionsMap } from '@/config/fileManagerConfig'

interface StageActionsState {
  definitions: ProcessingActionDefinition[]
  mapping: Record<string, string[]>
  loading: boolean
  loaded: boolean
  fetchMapping: (force?: boolean) => Promise<void>
  updateMapping: (newMapping: Record<string, string[]>) => Promise<boolean>
}

export const useStageActionsStore = create<StageActionsState>((set, get) => ({
  definitions: [],
  mapping: {},
  loading: false,
  loaded: false,

  fetchMapping: async (force = false) => {
    if (get().loading || (get().loaded && !force)) return
    set({ loading: true })
    try {
      const data = await stagesApi.getMapping()
      if (data?.mapping) {
        setDynamicStageActionsMap(data.mapping)
        set({
          definitions: data.definitions || [],
          mapping: data.mapping,
          loaded: true,
          loading: false,
        })
      } else {
        set({ loading: false })
      }
    } catch {
      set({ loading: false })
    }
  },

  updateMapping: async (newMapping: Record<string, string[]>) => {
    set({ loading: true })
    try {
      const res = await stagesApi.updateMapping(newMapping)
      if (res?.mapping) {
        setDynamicStageActionsMap(res.mapping)
        set({
          definitions: res.definitions || get().definitions,
          mapping: res.mapping,
          loaded: true,
          loading: false,
        })
        return true
      }
      set({ loading: false })
      return false
    } catch {
      set({ loading: false })
      return false
    }
  },
}))
