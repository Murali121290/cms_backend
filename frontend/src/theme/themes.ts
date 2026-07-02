export interface Theme {
  name: string
  label: string
  variables: Record<string, string>
}

export const themes: Theme[] = [
  {
    name: 'default',
    label: 'S4Carlisle Classic',
    variables: {
      '--color-sidebar':        '#1C1A17',
      '--color-sidebar-hover':  '#26231F',
      '--color-sidebar-text':   '#A8A091',
      '--color-sidebar-active': '#E8C896',
      '--color-primary':        '#C8841C',
      '--color-primary-hover':  '#A66A12',
      '--color-accent':         '#E8C896',
      '--color-background':     '#F4F1EA',
      '--color-card':           '#FFFFFF',
      '--color-border':         '#E6DFD1',
      '--color-text':           '#211E1A',
      '--color-muted':          '#8C8475',
      '--color-success':        '#2E7D52',
      '--color-warning':        '#A66A12',
      '--color-danger':         '#B3412C',
      '--color-info':           '#3B82F6',
    },
  },
  {
    name: 'slate',
    label: 'Slate Dark',
    variables: {
      '--color-sidebar':        '#0F172A',
      '--color-sidebar-hover':  '#1e293b',
      '--color-sidebar-text':   '#94a3b8',
      '--color-sidebar-active': '#ffffff',
      '--color-primary':        '#6366F1',
      '--color-primary-hover':  '#4f46e5',
      '--color-accent':         '#E0E7FF',
      '--color-background':     '#F1F5F9',
      '--color-card':           '#FFFFFF',
      '--color-border':         '#E2E8F0',
      '--color-text':           '#0F172A',
      '--color-muted':          '#64748B',
      '--color-success':        '#22C55E',
      '--color-warning':        '#F59E0B',
      '--color-danger':         '#EF4444',
      '--color-info':           '#3B82F6',
    },
  },
  {
    name: 'forest',
    label: 'Forest Green',
    variables: {
      '--color-sidebar':        '#14532D',
      '--color-sidebar-hover':  '#166534',
      '--color-sidebar-text':   '#86efac',
      '--color-sidebar-active': '#ffffff',
      '--color-primary':        '#16A34A',
      '--color-primary-hover':  '#15803d',
      '--color-accent':         '#DCFCE7',
      '--color-background':     '#F0FDF4',
      '--color-card':           '#FFFFFF',
      '--color-border':         '#D1FAE5',
      '--color-text':           '#14532D',
      '--color-muted':          '#6B7280',
      '--color-success':        '#22C55E',
      '--color-warning':        '#F59E0B',
      '--color-danger':         '#EF4444',
      '--color-info':           '#3B82F6',
    },
  },
]

export const defaultTheme = themes[0]
