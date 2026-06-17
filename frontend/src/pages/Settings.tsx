import { useNavigate } from 'react-router-dom'
import { Users, Building2, Shield, Sliders, Layers, Workflow, ChevronRight } from 'lucide-react'

const settingsCards = [
  {
    to: '/settings/users',
    icon: Users,
    title: 'User Management',
    description: 'Manage system users, roles, and access permissions',
    color: 'bg-blue-50',
    iconColor: 'text-blue-600',
  },
  {
    to: '/settings/customers',
    icon: Building2,
    title: 'Customer Management',
    description: 'Configure customer profiles and contact details',
    color: 'bg-green-50',
    iconColor: 'text-green-600',
  },
  {
    to: '/settings/stages',
    icon: Layers,
    title: 'Stage Management',
    description: 'Define and configure workflow stages and activities',
    color: 'bg-violet-50',
    iconColor: 'text-violet-600',
  },
  {
    to: '/settings/workflow',
    icon: Workflow,
    title: 'Workflow Setup',
    description: 'Build and manage workflow templates and automation',
    color: 'bg-teal-50',
    iconColor: 'text-teal-600',
  },
  {
    to: '/settings/roles',
    icon: Shield,
    title: 'Roles & Teams',
    description: 'Define system roles and team-based access control',
    color: 'bg-purple-50',
    iconColor: 'text-purple-600',
  },
  {
    to: '/settings/system',
    icon: Sliders,
    title: 'System Settings',
    description: 'Configure system preferences and global options',
    color: 'bg-slate-50',
    iconColor: 'text-slate-600',
  },
]

export function Settings() {
  const navigate = useNavigate()

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-text">Settings</h2>
        <p className="text-sm text-muted mt-1">Manage your system configuration and preferences</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {settingsCards.map(({ to, icon: Icon, title, description, color, iconColor }) => (
          <button
            key={to}
            onClick={() => navigate(to)}
            className="flex items-start gap-4 p-5 bg-card rounded-xl border border-border shadow-sm hover:shadow-md hover:border-primary/30 transition-all duration-200 text-left group"
          >
            <div className={`p-3 rounded-xl ${color} flex-shrink-0`}>
              <Icon size={22} className={iconColor} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text group-hover:text-primary transition-colors">{title}</p>
              <p className="text-xs text-muted mt-0.5 leading-relaxed">{description}</p>
            </div>
            <ChevronRight size={16} className="text-muted group-hover:text-primary mt-1 flex-shrink-0 transition-colors" />
          </button>
        ))}
      </div>
    </div>
  )
}
