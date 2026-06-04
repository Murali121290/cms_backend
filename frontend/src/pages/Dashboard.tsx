import { Users, FolderOpen, MessageCircleQuestion, TrendingUp, Clock } from 'lucide-react'
import { StatCard } from '@/components/ui/StatCard'
import { Card, CardHeader, CardBody, CardTitle } from '@/components/ui/Card'
import { Badge, statusToBadge } from '@/components/ui/Badge'
import { Table } from '@/components/ui/Table'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'

const areaData = [
  { month: 'Jan', completed: 12, inProgress: 18, delayed: 3 },
  { month: 'Feb', completed: 19, inProgress: 22, delayed: 2 },
  { month: 'Mar', completed: 15, inProgress: 20, delayed: 5 },
  { month: 'Apr', completed: 24, inProgress: 25, delayed: 1 },
  { month: 'May', completed: 28, inProgress: 30, delayed: 4 },
  { month: 'Jun', completed: 22, inProgress: 28, delayed: 2 },
]

const barData = [
  { stage: 'Initiation', count: 8 },
  { stage: 'Planning',   count: 12 },
  { stage: 'Design',     count: 15 },
  { stage: 'Dev',        count: 22 },
  { stage: 'Testing',    count: 18 },
  { stage: 'Review',     count: 10 },
  { stage: 'Deploy',     count: 6 },
  { stage: 'Closure',    count: 4 },
]

const pieData = [
  { name: 'Active',    value: 42, color: '#22C55E' },
  { name: 'Planning',  value: 18, color: '#6366F1' },
  { name: 'Review',    value: 12, color: '#F59E0B' },
  { name: 'Completed', value: 28, color: '#1F7A8C' },
]

interface RecentActivity {
  project: string
  client: string
  chapter: string
  assignee: string
  stage: string
  status: string
  due: string
}

const recentActivity: RecentActivity[] = [
  { project: 'Enterprise ERP Integration', client: 'Acme Corporation',  chapter: 'CH-001', assignee: 'alice_johnson',  stage: 'Development', status: 'In-progress', due: '2024-03-15' },
  { project: 'Automated Deployment',       client: 'Beta Technologies', chapter: 'CH-002', assignee: 'jane_smith',     stage: 'Testing',     status: 'In-progress', due: '2024-03-20' },
  { project: 'Core Banking Modernisation', client: 'Delta Finance Ltd', chapter: 'CH-001', assignee: 'bob_wilson',     stage: 'Review',      status: 'In-query',    due: '2024-06-30' },
  { project: 'E-commerce Platform',        client: 'Gamma Retail',      chapter: 'CH-002', assignee: 'fiona_apple',    stage: 'Development', status: 'In-progress', due: '2025-03-01' },
  { project: 'HMS Integration',            client: 'Epsilon Healthcare', chapter: 'CH-001', assignee: 'fiona_apple',   stage: 'Design',      status: 'In-progress', due: '2025-02-20' },
  { project: 'Cloud Infrastructure',       client: 'Acme Corporation',  chapter: 'CH-001', assignee: 'evan_rogers',    stage: 'Planning',    status: 'Hold',        due: '2024-05-01' },
  { project: 'Streaming CMS',              client: 'Eta Media Group',   chapter: 'CH-001', assignee: 'george_martin',  stage: 'Closure',     status: 'complete',    due: '2023-10-15' },
]

const columns = [
  { key: 'project',  header: 'Project',  className: 'min-w-[180px] font-medium' },
  { key: 'client',   header: 'Client',   className: 'text-muted' },
  { key: 'chapter',  header: 'Chapter' },
  { key: 'stage',    header: 'Stage' },
  { key: 'assignee', header: 'Assignee', render: (r: RecentActivity) => (
    <div className="flex items-center gap-2">
      <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
        {r.assignee[0].toUpperCase()}
      </div>
      <span className="text-sm">{r.assignee}</span>
    </div>
  )},
  { key: 'status', header: 'Status', render: (r: RecentActivity) => (
    <Badge variant={statusToBadge(r.status)}>{r.status}</Badge>
  )},
  { key: 'due', header: 'Due Date', className: 'text-muted text-xs' },
]

export function Dashboard() {
  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Active Clients"       value="10"  change="↑ 2 this month"  changeType="up"   icon={Users}                   iconBg="bg-blue-50"   iconColor="text-blue-600" />
        <StatCard title="In Progress Projects" value="7"   change="3 nearing due"   changeType="down" icon={FolderOpen}               iconBg="bg-green-50"  iconColor="text-green-600" />
        <StatCard title="Delayed Chapters"     value="2"   change="↓ 1 from last week" changeType="up" icon={Clock}                  iconBg="bg-red-50"    iconColor="text-red-500" />
        <StatCard title="Open Inquiries"       value="4"   change="Needs attention" changeType="down" icon={MessageCircleQuestion}   iconBg="bg-orange-50" iconColor="text-orange-500" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Area chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Chapter Progress Overview</CardTitle>
            <div className="flex items-center gap-3 text-xs text-muted">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary inline-block" />Completed</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent inline-block" />In Progress</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-danger inline-block" />Delayed</span>
            </div>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={areaData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gCompleted" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--color-primary)" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gProgress" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--color-accent)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="completed"  stroke="var(--color-primary)" strokeWidth={2} fill="url(#gCompleted)" />
                <Area type="monotone" dataKey="inProgress" stroke="#BFDBF7"              strokeWidth={2} fill="url(#gProgress)"  />
                <Area type="monotone" dataKey="delayed"    stroke="var(--color-danger)"  strokeWidth={2} fill="none" strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {/* Pie chart */}
        <Card>
          <CardHeader>
            <CardTitle>Project Status</CardTitle>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="45%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      </div>

      {/* Bar chart + Team */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Chapters by Stage</CardTitle>
            <span className="text-xs text-muted flex items-center gap-1"><TrendingUp size={12} /> Current month</span>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="stage" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {/* Team */}
        <Card>
          <CardHeader>
            <CardTitle>Team Activity</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 pt-3">
            {[
              { name: 'alice_johnson',  role: 'Developer',  tasks: 3, color: 'bg-blue-500' },
              { name: 'jane_smith',     role: 'Developer',  tasks: 2, color: 'bg-green-500' },
              { name: 'bob_wilson',     role: 'Analyst',    tasks: 1, color: 'bg-purple-500' },
              { name: 'fiona_apple',    role: 'Designer',   tasks: 2, color: 'bg-pink-500' },
              { name: 'evan_rogers',    role: 'Developer',  tasks: 1, color: 'bg-orange-500' },
              { name: 'george_martin',  role: 'Manager',    tasks: 2, color: 'bg-teal-500' },
            ].map((m) => (
              <div key={m.name} className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full ${m.color} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                  {m.name[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text truncate">{m.name}</p>
                  <p className="text-xs text-muted">{m.role}</p>
                </div>
                <span className="text-xs font-semibold text-primary bg-accent px-2 py-0.5 rounded-full">
                  {m.tasks} tasks
                </span>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      {/* Activity Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Workflow Activity</CardTitle>
          <button className="text-xs text-primary hover:underline font-medium">View all</button>
        </CardHeader>
        <Table columns={columns as never} data={recentActivity as never} />
      </Card>
    </div>
  )
}
