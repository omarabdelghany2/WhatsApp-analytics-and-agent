import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { useWebSocket } from '../contexts/WebSocketContext'
import { useAdmin } from '../contexts/AdminContext'
import { UserPlus, UserMinus, Users, Filter, Download, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { useLocation } from 'react-router-dom'

export default function EventsPage() {
  const { viewingUser } = useAdmin()
  const location = useLocation()
  const isAdminView = location.pathname.startsWith('/admin/user')

  const queryClient = useQueryClient()
  const { subscribe } = useWebSocket()
  const [filters, setFilters] = useState({
    event_type: '',
    date_from: '',
    date_to: '',
    member_name: '',
    group_id: undefined as number | undefined,
  })
  const [page, setPage] = useState(0)
  const [isExporting, setIsExporting] = useState(false)
  const limit = 50

  const { data: groups } = useQuery({
    queryKey: isAdminView && viewingUser ? ['admin-user-groups', viewingUser.id] : ['groups'],
    queryFn: () =>
      isAdminView && viewingUser
        ? api.getAdminUserGroups(viewingUser.id)
        : api.getGroups(),
  })

  const { data: events } = useQuery({
    queryKey: isAdminView && viewingUser
      ? ['admin-user-events', viewingUser.id, filters, page]
      : ['events', filters, page],
    queryFn: () =>
      isAdminView && viewingUser
        ? api.getAdminUserEvents(viewingUser.id, {
            event_type: filters.event_type || undefined,
            date_from: filters.date_from || undefined,
            date_to: filters.date_to || undefined,
            member_name: filters.member_name || undefined,
            group_id: filters.group_id,
            limit,
            offset: page * limit,
          })
        : api.getEvents({
            ...filters,
            limit,
            offset: page * limit,
          }),
  })

  const { data: summary } = useQuery({
    queryKey: ['events-summary', filters],
    queryFn: () =>
      api.getEventsSummary({
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
        group_id: filters.group_id,
      }),
    enabled: !isAdminView,
  })

  // Subscribe to real-time member events (only for regular users)
  useEffect(() => {
    if (isAdminView) return

    const unsubscribeJoin = subscribe('member_join', () => {
      queryClient.invalidateQueries({ queryKey: ['events'] })
      queryClient.invalidateQueries({ queryKey: ['events-summary'] })
    })

    const unsubscribeLeave = subscribe('member_leave', () => {
      queryClient.invalidateQueries({ queryKey: ['events'] })
      queryClient.invalidateQueries({ queryKey: ['events-summary'] })
    })

    return () => {
      unsubscribeJoin()
      unsubscribeLeave()
    }
  }, [subscribe, queryClient, isAdminView])

  const handleFilterChange = (key: keyof typeof filters, value: string | number | undefined) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPage(0)
  }

  const clearFilters = () => {
    setFilters({
      event_type: '',
      date_from: '',
      date_to: '',
      member_name: '',
      group_id: undefined,
    })
    setPage(0)
  }

  const handleExportCSV = async () => {
    if (isAdminView) return // No export for admin view
    setIsExporting(true)
    try {
      await api.exportEventsCSV({
        event_type: filters.event_type || undefined,
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

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground mb-8">Member Events</h1>

      {/* Summary Stats - only for regular users */}
      {!isAdminView && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-surface rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="bg-green-500/20 p-2 rounded-lg">
                <UserPlus className="text-green-500" size={20} />
              </div>
              <div>
                <p className="text-muted text-sm">Total Joins</p>
                <p className="text-xl font-bold text-foreground">{summary?.total_joins || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-surface rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="bg-red-500/20 p-2 rounded-lg">
                <UserMinus className="text-red-500" size={20} />
              </div>
              <div>
                <p className="text-muted text-sm">Total Leaves</p>
                <p className="text-xl font-bold text-foreground">{summary?.total_leaves || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-surface rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary/20 p-2 rounded-lg">
                <Users className="text-primary" size={20} />
              </div>
              <div>
                <p className="text-muted text-sm">Net Change</p>
                <p className={`text-xl font-bold ${(summary?.net_change || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {(summary?.net_change || 0) >= 0 ? '+' : ''}{summary?.net_change || 0}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

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
                disabled={isExporting || !events?.events?.length}
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Event Type */}
          <div>
            <label className="block text-sm text-muted mb-2">Event Type</label>
            <select
              value={filters.event_type}
              onChange={e => handleFilterChange('event_type', e.target.value)}
              className="w-full px-4 py-2 bg-surface-secondary border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All Events</option>
              <option value="JOIN">Joins</option>
              <option value="LEAVE">Leaves</option>
            </select>
          </div>

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
            <label className="block text-sm text-muted mb-2">Member Name</label>
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

      {/* Events List */}
      <div className="bg-surface rounded-lg border border-border">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            {events?.total || 0} Events
          </h2>
        </div>

        {events?.events && events.events.length > 0 ? (
          <>
            <div className="divide-y divide-border">
              {events.events.map(event => (
                <div key={event.id} className="p-4 flex items-center gap-4">
                  <div className={`p-2 rounded-lg ${event.event_type === 'JOIN' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                    {event.event_type === 'JOIN' ? (
                      <UserPlus className="text-green-500" size={20} />
                    ) : (
                      <UserMinus className="text-red-500" size={20} />
                    )}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{event.member_name}</span>
                      {event.member_phone && (
                        <span className="text-sm text-muted">({event.member_phone})</span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded ${event.event_type === 'JOIN' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                        {event.event_type}
                      </span>
                    </div>
                    <p className="text-sm text-muted">{event.group_name}</p>
                  </div>

                  <div className="text-right">
                    <p className="text-sm text-foreground">{format(new Date(event.event_date), 'MMM d, yyyy')}</p>
                    <p className="text-xs text-muted">{format(new Date(event.timestamp), 'HH:mm')}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {events.total > limit && (
              <div className="p-4 border-t border-border flex items-center justify-between">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-4 py-2 bg-surface-secondary text-foreground rounded-lg disabled:opacity-50 hover:bg-surface-secondary/80"
                >
                  Previous
                </button>
                <span className="text-muted text-sm">
                  Page {page + 1} of {Math.ceil(events.total / limit)}
                </span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={(page + 1) * limit >= events.total}
                  className="px-4 py-2 bg-surface-secondary text-foreground rounded-lg disabled:opacity-50 hover:bg-surface-secondary/80"
                >
                  Next
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="p-8 text-center text-muted">
            <Users size={48} className="mx-auto mb-4 opacity-50" />
            <p>No events found</p>
            <p className="text-sm mt-2">Try adjusting your filters</p>
          </div>
        )}
      </div>
    </div>
  )
}
