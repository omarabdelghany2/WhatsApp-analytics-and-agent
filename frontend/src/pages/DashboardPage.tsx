import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { useAdmin } from '../contexts/AdminContext'
import { MessageSquare, Users, UserPlus, UserMinus, TrendingUp } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

export default function DashboardPage() {
  const { viewingUser, isViewingUser } = useAdmin()
  const location = useLocation()
  const isAdminView = location.pathname.startsWith('/admin/user')

  const { data: overview, isLoading } = useQuery({
    queryKey: isAdminView && viewingUser ? ['admin-user-overview', viewingUser.id] : ['overview'],
    queryFn: () =>
      isAdminView && viewingUser
        ? api.getAdminUserOverview(viewingUser.id)
        : api.getOverview(),
  })

  const { data: groups } = useQuery({
    queryKey: isAdminView && viewingUser ? ['admin-user-groups', viewingUser.id] : ['groups'],
    queryFn: () =>
      isAdminView && viewingUser
        ? api.getAdminUserGroups(viewingUser.id)
        : api.getGroups(),
  })

  const { data: whatsappStatus } = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => api.getWhatsAppStatus(),
    enabled: !isAdminView, // Only fetch for regular users
  })

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  const stats = [
    {
      label: 'Total Messages',
      value: overview?.total_messages || 0,
      icon: MessageSquare,
      color: 'bg-blue-500',
    },
    {
      label: 'Monitored Groups',
      value: overview?.total_groups || 0,
      icon: Users,
      color: 'bg-purple-500',
    },
    {
      label: 'Total Joins',
      value: overview?.total_joins || 0,
      icon: UserPlus,
      color: 'bg-green-500',
    },
    {
      label: 'Total Leaves',
      value: overview?.total_leaves || 0,
      icon: UserMinus,
      color: 'bg-red-500',
    },
    {
      label: 'Net Change',
      value: overview?.net_member_change || 0,
      icon: TrendingUp,
      color: 'bg-amber-500',
    },
    {
      label: 'Unique Senders',
      value: overview?.unique_senders || 0,
      icon: Users,
      color: 'bg-cyan-500',
    },
  ]

  const basePath = isAdminView ? '/admin/user' : ''

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-white mb-8">Dashboard</h1>

      {/* WhatsApp Status Banner - only for regular users */}
      {!isAdminView && !whatsappStatus?.is_authenticated && (
        <div className="mb-8 bg-amber-500/10 border border-amber-500 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-amber-500 font-medium">WhatsApp Not Connected</p>
              <p className="text-amber-400/80 text-sm">
                Connect your WhatsApp account to start monitoring groups
              </p>
            </div>
            <Link
              to={`${basePath}/connect`}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
            >
              Connect Now
            </Link>
          </div>
        </div>
      )}

      {/* Admin viewing user - show WhatsApp status */}
      {isAdminView && viewingUser && (
        <div className={`mb-8 ${viewingUser.whatsapp_connected ? 'bg-green-500/10 border-green-500' : 'bg-slate-700/50 border-slate-600'} border rounded-lg p-4`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`font-medium ${viewingUser.whatsapp_connected ? 'text-green-500' : 'text-slate-400'}`}>
                {viewingUser.whatsapp_connected ? 'WhatsApp Connected' : 'WhatsApp Not Connected'}
              </p>
              {viewingUser.whatsapp_phone && (
                <p className="text-green-400/80 text-sm">{viewingUser.whatsapp_phone}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {stats.map(stat => {
          const Icon = stat.icon
          return (
            <div
              key={stat.label}
              className="bg-slate-800 rounded-lg p-6 border border-slate-700"
            >
              <div className="flex items-center gap-4">
                <div className={`${stat.color} p-3 rounded-lg`}>
                  <Icon size={24} className="text-white" />
                </div>
                <div>
                  <p className="text-slate-400 text-sm">{stat.label}</p>
                  <p className="text-2xl font-bold text-white">{stat.value.toLocaleString()}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Groups List */}
      <div className="bg-slate-800 rounded-lg border border-slate-700">
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Monitored Groups</h2>
          {!isAdminView && (
            <Link
              to="/connect"
              className="text-sm text-blue-500 hover:text-blue-400"
            >
              Add Group
            </Link>
          )}
        </div>

        {groups && groups.length > 0 ? (
          <div className="divide-y divide-slate-700">
            {groups.map(group => (
              <div key={group.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-white font-medium">{group.group_name}</p>
                  <p className="text-sm text-slate-400">
                    {group.member_count} members
                  </p>
                </div>
                <Link
                  to={`${basePath}/messages?group=${group.id}`}
                  className="text-sm text-blue-500 hover:text-blue-400"
                >
                  View Messages
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-slate-400">
            <p>No groups being monitored</p>
            {!isAdminView && (
              <p className="text-sm mt-2">
                Connect your WhatsApp and add groups to start monitoring
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
