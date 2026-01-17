import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { useAdmin } from '../contexts/AdminContext'
import { BarChart3, TrendingUp, Users, MessageSquare } from 'lucide-react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

export default function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const [selectedGroup, setSelectedGroup] = useState<number | undefined>()
  const { viewingUser } = useAdmin()
  const isAdminView = !!viewingUser

  const { data: groups } = useQuery({
    queryKey: ['groups', isAdminView ? viewingUser?.id : 'self'],
    queryFn: () => isAdminView ? api.getAdminUserGroups(viewingUser!.id) : api.getGroups(),
  })

  const { data: overview } = useQuery({
    queryKey: ['overview', days, selectedGroup, isAdminView ? viewingUser?.id : 'self'],
    queryFn: () => isAdminView
      ? api.getAdminUserOverview(viewingUser!.id)
      : api.getOverview(days, selectedGroup),
  })

  const { data: dailyStats } = useQuery({
    queryKey: ['daily-stats', days, selectedGroup, isAdminView ? viewingUser?.id : 'self'],
    queryFn: () => isAdminView
      ? api.getAdminUserDailyStats(viewingUser!.id, days, selectedGroup)
      : api.getDailyStats(days, selectedGroup),
  })

  const { data: topSenders } = useQuery({
    queryKey: ['top-senders', selectedGroup, isAdminView ? viewingUser?.id : 'self'],
    queryFn: () => isAdminView
      ? api.getAdminUserTopSenders(viewingUser!.id, 10, selectedGroup)
      : api.getTopSenders(10, selectedGroup),
  })

  const { data: memberChanges } = useQuery({
    queryKey: ['member-changes', days, selectedGroup, isAdminView ? viewingUser?.id : 'self'],
    queryFn: () => isAdminView
      ? api.getAdminUserMemberChanges(viewingUser!.id, days, selectedGroup)
      : api.getMemberChanges(days, selectedGroup),
  })

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground mb-8">Analytics</h1>

      {/* Filters */}
      <div className="bg-surface rounded-lg border border-border p-4 mb-8">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm text-muted mb-2">Time Period</label>
            <select
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              className="px-4 py-2 bg-surface-secondary border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-muted mb-2">Group</label>
            <select
              value={selectedGroup || ''}
              onChange={e => setSelectedGroup(e.target.value ? Number(e.target.value) : undefined)}
              className="px-4 py-2 bg-surface-secondary border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All Groups</option>
              {groups?.map(group => (
                <option key={group.id} value={group.id}>
                  {group.group_name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/20 p-2 rounded-lg">
              <MessageSquare className="text-primary" size={20} />
            </div>
            <div>
              <p className="text-muted text-sm">Total Messages</p>
              <p className="text-xl font-bold text-foreground">{overview?.total_messages?.toLocaleString() || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="bg-purple-500/20 p-2 rounded-lg">
              <Users className="text-purple-500" size={20} />
            </div>
            <div>
              <p className="text-muted text-sm">Unique Senders</p>
              <p className="text-xl font-bold text-foreground">{overview?.unique_senders?.toLocaleString() || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="bg-green-500/20 p-2 rounded-lg">
              <TrendingUp className="text-green-500" size={20} />
            </div>
            <div>
              <p className="text-muted text-sm">Member Joins</p>
              <p className="text-xl font-bold text-foreground">{overview?.total_joins?.toLocaleString() || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="bg-amber-500/20 p-2 rounded-lg">
              <BarChart3 className="text-amber-500" size={20} />
            </div>
            <div>
              <p className="text-muted text-sm">Net Change</p>
              <p className={`text-xl font-bold ${(overview?.net_member_change || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {(overview?.net_member_change || 0) >= 0 ? '+' : ''}{overview?.net_member_change || 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Daily Messages Chart */}
        <div className="bg-surface rounded-lg border border-border p-4">
          <h2 className="text-lg font-semibold text-foreground mb-4">Daily Messages</h2>
          <div className="h-64">
            {dailyStats && dailyStats.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyStats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                    labelStyle={{ color: '#e2e8f0' }}
                  />
                  <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted">
                No data available
              </div>
            )}
          </div>
        </div>

        {/* Member Changes Chart */}
        <div className="bg-surface rounded-lg border border-border p-4">
          <h2 className="text-lg font-semibold text-foreground mb-4">Member Changes</h2>
          <div className="h-64">
            {memberChanges && memberChanges.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={memberChanges}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                    labelStyle={{ color: '#e2e8f0' }}
                  />
                  <Legend />
                  <Bar dataKey="joins" fill="#22c55e" name="Joins" />
                  <Bar dataKey="leaves" fill="#ef4444" name="Leaves" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted">
                No data available
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Top Senders */}
      <div className="bg-surface rounded-lg border border-border">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Top Senders</h2>
        </div>
        {topSenders && topSenders.length > 0 ? (
          <div className="divide-y divide-border">
            {topSenders.map((sender, index) => (
              <div key={`${sender.sender_name}-${sender.sender_phone}`} className="p-4 flex items-center gap-4">
                <span className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-sm font-medium">
                  {index + 1}
                </span>
                <div className="flex-1">
                  <p className="text-foreground font-medium">{sender.sender_name}</p>
                  {sender.sender_phone && (
                    <p className="text-sm text-muted">{sender.sender_phone}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-foreground font-medium">{sender.message_count.toLocaleString()}</p>
                  <p className="text-xs text-muted">messages</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-muted">
            No sender data available
          </div>
        )}
      </div>
    </div>
  )
}
