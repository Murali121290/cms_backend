export interface Theme {
  name: string
  label: string
  variables: Record<string, string>
}

export const themes: Theme[] = [
  {
    name: 'default',
    label: 'Ocean Blue',
    variables: {
      '--color-sidebar':        '#022B3A',
      '--color-sidebar-hover':  '#0a3d50',
      '--color-sidebar-text':   '#94a3b8',
      '--color-sidebar-active': '#ffffff',
      '--color-primary':        '#1F7A8C',
      '--color-primary-hover':  '#165f6e',
      '--color-accent':         '#BFDBF7',
      '--color-background':     '#F8FAFC',
      '--color-card':           '#FFFFFF',
      '--color-border':         '#E2E8F0',
      '--color-text':           '#1E293B',
      '--color-muted':          '#64748B',
      '--color-success':        '#22C55E',
      '--color-warning':        '#F59E0B',
      '--color-danger':         '#EF4444',
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
