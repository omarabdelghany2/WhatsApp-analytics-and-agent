import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { useWebSocket } from '../contexts/WebSocketContext'
import { useAdmin } from '../contexts/AdminContext'
import { Award, Users, Filter, Download, Loader2 } from 'lucide-react'
import { useLocation } from 'react-router-dom'

export default function CertificatesPage() {
  const { viewingUser } = useAdmin()
  const location = useLocation()
  const isAdminView = location.pathname.startsWith('/admin/user')

  const queryClient = useQueryClient()
  const { subscribe } = useWebSocket()
  const [filters, setFilters] = useState({
    date_from: '',
    date_to: '',
    member_name: '',
    group_id: undefined as number | undefined,
  })
  const [isExporting, setIsExporting] = useState(false)

  const { data: groups } = useQuery({
    queryKey: isAdminView && viewingUser ? ['admin-user-groups', viewingUser.id] : ['groups'],
    queryFn: () =>
      isAdminView && viewingUser
        ? api.getAdminUserGroups(viewingUser.id)
        : api.getGroups(),
  })

  const { data: summary, isLoading } = useQuery({
    queryKey: isAdminView && viewingUser
      ? ['admin-user-certificates-summary', viewingUser.id, filters]
      : ['certificates-summary', filters],
    queryFn: () =>
      isAdminView && viewingUser
        ? api.getAdminUserCertificatesSummary(viewingUser.id, {
            date_from: filters.date_from || undefined,
            date_to: filters.date_to || undefined,
            group_id: filters.group_id,
          })
        : api.getCertificatesSummary({
            date_from: filters.date_from || undefined,
            date_to: filters.date_to || undefined,
            group_id: filters.group_id,
          }),
  })

  // Subscribe to real-time certificate events (only for regular users)
  useEffect(() => {
    if (isAdminView) return

    const unsubscribe = subscribe('certificate', () => {
      queryClient.invalidateQueries({ queryKey: ['certificates-summary'] })
    })

    return () => {
      unsubscribe()
    }
  }, [subscribe, queryClient, isAdminView])

  const handleFilterChange = (key: keyof typeof filters, value: string | number | undefined) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const clearFilters = () => {
    setFilters({
      date_from: '',
      date_to: '',
      member_name: '',
      group_id: undefined,
    })
  }

  const handleExportCSV = async () => {
    if (isAdminView) return
    setIsExporting(true)
    try {
      await api.exportCertificatesCSV({
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
        member_name: filters.member_name || undefined,
        group_id: filters.group_id,
      })
    } catch (error) {
      console.error('Failed to export CSV:', error)
      alert('Failed to export CSV. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  // Filter summary by member name (client-side filter since API already filtered)
  const filteredSummary = summary?.summary?.filter(item => {
    if (!filters.member_name) return true
    return item.member_name.toLowerCase().includes(filters.member_name.toLowerCase()) ||
           (item.member_phone && item.member_phone.includes(filters.member_name))
  }) || []

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground mb-8">Certificates</h1>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="bg-amber-500/20 p-2 rounded-lg">
              <Award className="text-amber-500" size={20} />
            </div>
            <div>
              <p className="text-muted text-sm">Total Certificates</p>
              <p className="text-xl font-bold text-foreground">{summary?.total_certificates || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/20 p-2 rounded-lg">
              <Users className="text-primary" size={20} />
            </div>
            <div>
              <p className="text-muted text-sm">Unique Members</p>
              <p className="text-xl font-bold text-foreground">{summary?.unique_members || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-surface rounded-lg border border-border p-4 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={18} className="text-muted" />
          <span className="text-foreground font-medium">Filters</span>
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={clearFilters}
              className="text-sm text-primary hover:text-primary-hover"
            >
              Clear All
            </button>
            {!isAdminView && (
              <button
                onClick={handleExportCSV}
                disabled={isExporting || !summary?.summary?.length}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isExporting ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Download size={16} />
                )}
                Export CSV
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Group */}
          <div>
            <label className="block text-sm text-muted mb-2">Group</label>
            <select
              value={filters.group_id || ''}
              onChange={e => handleFilterChange('group_id', e.target.value ? Number(e.target.value) : undefined)}
              className="w-full px-4 py-2 bg-surface-secondary border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All Groups</option>
              {groups?.map(group => (
                <option key={group.id} value={group.id}>
                  {group.group_name}
                </option>
              ))}
            </select>
          </div>

          {/* Date From */}
          <div>
            <label className="block text-sm text-muted mb-2">From Date</label>
            <input
              type="date"
              value={filters.date_from}
              onChange={e => handleFilterChange('date_from', e.target.value)}
              className="w-full px-4 py-2 bg-surface-secondary border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="block text-sm text-muted mb-2">To Date</label>
            <input
              type="date"
              value={filters.date_to}
              onChange={e => handleFilterChange('date_to', e.target.value)}
              className="w-full px-4 py-2 bg-surface-secondary border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Member Name */}
          <div>
            <label className="block text-sm text-muted mb-2">Member Name/Phone</label>
            <input
              type="text"
              value={filters.member_name}
              onChange={e => handleFilterChange('member_name', e.target.value)}
              placeholder="Search member..."
              className="w-full px-4 py-2 bg-surface-secondary border border-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      {/* Certificates Table */}
      <div className="bg-surface rounded-lg border border-border">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            Certificate Summary ({filteredSummary.length} members)
          </h2>
        </div>

        {isLoading ? (
          <div className="p-8 text-center">
            <Loader2 className="animate-spin mx-auto mb-4 text-muted" size={32} />
            <p className="text-muted">Loading certificates...</p>
          </div>
        ) : filteredSummary.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-4 text-muted font-medium">Member Name</th>
                  <th className="text-left p-4 text-muted font-medium">Phone Number</th>
                  <th className="text-center p-4 text-muted font-medium">Certificates</th>
                  <th className="text-left p-4 text-muted font-medium">Groups</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredSummary.map((item, index) => (
                  <tr key={index} className="hover:bg-surface-secondary/50">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="bg-amber-500/20 p-1.5 rounded-lg">
                          <Award className="text-amber-500" size={16} />
                        </div>
                        <span className="text-foreground font-medium">{item.member_name}</span>
                      </div>
                    </td>
                    <td className="p-4 text-foreground-secondary">
                      {item.member_phone || '-'}
                    </td>
                    <td className="p-4 text-center">
                      <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 bg-amber-500/20 text-amber-500 rounded-full font-bold">
                        {item.certificate_count}
                      </span>
                    </td>
                    <td className="p-4 text-muted text-sm">
                      {item.groups || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-muted">
            <Award size={48} className="mx-auto mb-4 opacity-50" />
            <p>No certificates found</p>
            <p className="text-sm mt-2">
              Certificates are recorded when members send voice messages
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
