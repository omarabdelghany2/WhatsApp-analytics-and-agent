import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { useWebSocket } from '../contexts/WebSocketContext'
import {
  Settings,
  Clock,
  History,
  Check,
  X,
  Loader2,
  Users,
  AlertCircle,
  Plus,
  Trash2,
  Power,
  PowerOff,
  Lock,
  Unlock,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { format } from 'date-fns'

type Tab = 'schedules' | 'manual' | 'history'
type MentionType = 'none' | 'all' | 'selected'

interface Group {
  id: number
  whatsapp_group_id: string
  group_name: string
  member_count: number
  is_active: boolean
}

interface Schedule {
  id: number
  group_ids: number[]
  group_names: string[]
  open_time: string | null
  close_time: string | null
  open_message: string | null
  close_message: string | null
  is_active: boolean
  next_open: string | null
  next_close: string | null
}

interface SettingsProgress {
  task_id: number
  action: string
  group_name: string
  groups_done: number
  total_groups: number
}

interface SettingsComplete {
  task_id?: number
  action: string
  status?: string
  groups_success: number
  groups_failed: number
  errors?: string[] | null
  error_message?: string | null
}

export default function GroupSettingsPage() {
  const queryClient = useQueryClient()
  const { subscribe } = useWebSocket()

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>('schedules')

  // Create schedule modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedGroups, setSelectedGroups] = useState<Group[]>([])
  const [openTime, setOpenTime] = useState('09:00')
  const [closeTime, setCloseTime] = useState('21:00')
  const [openMessage, setOpenMessage] = useState('')
  const [closeMessage, setCloseMessage] = useState('')
  const [mentionType, setMentionType] = useState<MentionType>('none')
  const [groupsExpanded, setGroupsExpanded] = useState(true)

  // Manual control state
  const [manualGroups, setManualGroups] = useState<Group[]>([])
  const [manualMessage, setManualMessage] = useState('')
  const [manualMentionType, setManualMentionType] = useState<MentionType>('none')
  const [manualGroupsExpanded, setManualGroupsExpanded] = useState(true)

  // Progress state
  const [showProgressModal, setShowProgressModal] = useState(false)
  const [currentProgress, setCurrentProgress] = useState<SettingsProgress | null>(null)
  const [settingsResult, setSettingsResult] = useState<SettingsComplete | null>(null)

  // Fetch groups
  const { data: groups } = useQuery({
    queryKey: ['groups'],
    queryFn: () => api.getGroups(),
  })

  // Fetch schedules
  const { data: schedulesData, refetch: refetchSchedules } = useQuery({
    queryKey: ['settings-schedules'],
    queryFn: () => api.getSettingsSchedules(),
  })

  // Fetch history
  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ['settings-history'],
    queryFn: () => api.getGroupSettingsHistory(50),
  })

  // Create schedule mutation
  const createScheduleMutation = useMutation({
    mutationFn: (data: {
      group_ids: number[]
      open_time: string
      close_time: string
      open_message?: string
      close_message?: string
      mention_type?: MentionType
    }) => api.createSettingsSchedule(data),
    onSuccess: () => {
      setShowCreateModal(false)
      resetCreateForm()
      refetchSchedules()
    },
  })

  // Delete schedule mutation
  const deleteScheduleMutation = useMutation({
    mutationFn: (scheduleId: number) => api.deleteSettingsSchedule(scheduleId),
    onSuccess: () => {
      refetchSchedules()
    },
    onError: (error) => {
      console.error('Failed to delete schedule:', error)
      alert(`Failed to delete schedule: ${(error as Error).message}`)
    },
  })

  // Toggle schedule mutation
  const toggleScheduleMutation = useMutation({
    mutationFn: (scheduleId: number) => api.toggleSettingsSchedule(scheduleId),
    onSuccess: () => {
      refetchSchedules()
    },
  })

  // Set group settings now mutation
  const setSettingsNowMutation = useMutation({
    mutationFn: (data: {
      group_ids: number[]
      admin_only: boolean
      message?: string
      mention_type?: MentionType
    }) => api.setGroupSettingsNow(data),
    onSuccess: () => {
      setShowProgressModal(true)
      setCurrentProgress(null)
      setSettingsResult(null)
    },
  })

  // Subscribe to WebSocket events
  useEffect(() => {
    const unsubProgress = subscribe('settings_progress', (data) => {
      const progress = data as unknown as SettingsProgress
      setCurrentProgress(progress)
    })

    const unsubComplete = subscribe('settings_complete', (data) => {
      const result = data as unknown as SettingsComplete
      setSettingsResult(result)
      setCurrentProgress(null)
      refetchHistory()
    })

    const unsubImmediateProgress = subscribe('immediate_settings_progress', (data) => {
      const progress = data as unknown as SettingsProgress
      setCurrentProgress(progress)
    })

    const unsubImmediateComplete = subscribe('immediate_settings_complete', (data) => {
      const result = data as unknown as SettingsComplete
      setSettingsResult(result)
      setCurrentProgress(null)
      refetchHistory()
    })

    return () => {
      unsubProgress()
      unsubComplete()
      unsubImmediateProgress()
      unsubImmediateComplete()
    }
  }, [subscribe, refetchHistory])

  // Reset create form
  const resetCreateForm = () => {
    setSelectedGroups([])
    setOpenTime('09:00')
    setCloseTime('21:00')
    setOpenMessage('')
    setCloseMessage('')
    setMentionType('none')
  }

  // Reset manual form
  const resetManualForm = () => {
    setManualGroups([])
    setManualMessage('')
    setManualMentionType('none')
  }

  // Handle group selection (for create schedule)
  const toggleGroup = (group: Group) => {
    setSelectedGroups((prev) =>
      prev.some((g) => g.id === group.id)
        ? prev.filter((g) => g.id !== group.id)
        : [...prev, group]
    )
  }

  // Handle group selection (for manual control)
  const toggleManualGroup = (group: Group) => {
    setManualGroups((prev) =>
      prev.some((g) => g.id === group.id)
        ? prev.filter((g) => g.id !== group.id)
        : [...prev, group]
    )
  }

  const selectAllGroups = (forManual = false) => {
    if (groups) {
      if (forManual) {
        setManualGroups(groups)
      } else {
        setSelectedGroups(groups)
      }
    }
  }

  const deselectAllGroups = (forManual = false) => {
    if (forManual) {
      setManualGroups([])
    } else {
      setSelectedGroups([])
    }
  }

  // Handle create schedule
  const handleCreateSchedule = () => {
    if (selectedGroups.length === 0) return

    createScheduleMutation.mutate({
      group_ids: selectedGroups.map((g) => g.id),
      open_time: openTime,
      close_time: closeTime,
      open_message: openMessage || undefined,
      close_message: closeMessage || undefined,
      mention_type: mentionType,
    })
  }

  // Handle manual control
  const handleManualControl = (adminOnly: boolean) => {
    if (manualGroups.length === 0) return

    setSettingsNowMutation.mutate({
      group_ids: manualGroups.map((g) => g.id),
      admin_only: adminOnly,
      message: manualMessage || undefined,
      mention_type: manualMentionType,
    })
  }

  // Handle progress modal close
  const handleProgressClose = () => {
    setShowProgressModal(false)
    setCurrentProgress(null)
    setSettingsResult(null)
    if (settingsResult) {
      resetManualForm()
    }
  }

  // Render status badge
  const renderStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-500/20 text-yellow-400',
      sending: 'bg-blue-500/20 text-blue-400',
      sent: 'bg-green-500/20 text-green-400',
      partially_sent: 'bg-orange-500/20 text-orange-400',
      failed: 'bg-red-500/20 text-red-400',
      cancelled: 'bg-slate-500/20 text-slate-400',
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.pending}`}>
        {status.replace('_', ' ')}
      </span>
    )
  }

  // Render group selector
  const renderGroupSelector = (
    selected: Group[],
    toggle: (g: Group) => void,
    selectAll: () => void,
    deselectAll: () => void,
    expanded: boolean,
    setExpanded: (v: boolean) => void
  ) => (
    <div className="bg-slate-800 rounded-lg overflow-hidden">
      <div
        className="p-4 border-b border-slate-700 flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div>
          <h3 className="font-medium text-white flex items-center gap-2">
            <Users size={18} />
            Select Groups
          </h3>
          <p className="text-sm text-slate-400 mt-1">
            {selected.length} of {groups?.length || 0} selected
          </p>
        </div>
        {expanded ? (
          <ChevronUp size={20} className="text-slate-400" />
        ) : (
          <ChevronDown size={20} className="text-slate-400" />
        )}
      </div>

      {expanded && (
        <>
          <div className="p-3 border-b border-slate-700 flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); selectAll() }}
              className="flex-1 py-1.5 text-sm bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors"
            >
              Select All
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); deselectAll() }}
              className="flex-1 py-1.5 text-sm bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors"
            >
              Deselect All
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {groups && groups.length > 0 ? (
              <div className="divide-y divide-slate-700">
                {groups.map((group) => (
                  <button
                    key={group.id}
                    onClick={() => toggle(group)}
                    className="w-full p-3 flex items-center gap-3 hover:bg-slate-700/50 transition-colors text-left"
                  >
                    {selected.some((g) => g.id === group.id) ? (
                      <CheckSquare size={20} className="text-blue-400 flex-shrink-0" />
                    ) : (
                      <Square size={20} className="text-slate-500 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white truncate">{group.group_name}</p>
                      <p className="text-xs text-slate-400">{group.member_count} members</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-slate-400">
                <Users size={32} className="mx-auto mb-2 opacity-50" />
                <p>No groups available</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Group Settings Scheduler</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-slate-700">
        <button
          onClick={() => setActiveTab('schedules')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'schedules'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Clock size={16} className="inline mr-2" />
          Schedules ({schedulesData?.schedules?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab('manual')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'manual'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Settings size={16} className="inline mr-2" />
          Manual Control
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'history'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <History size={16} className="inline mr-2" />
          History
        </button>
      </div>

      {/* Schedules Tab */}
      {activeTab === 'schedules' && (
        <div className="space-y-4">
          {/* Create Schedule Button */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="w-full py-4 bg-slate-800 border-2 border-dashed border-slate-600 rounded-lg hover:border-blue-500 transition-colors flex items-center justify-center gap-2 text-slate-300 hover:text-white"
          >
            <Plus size={20} />
            Create New Schedule
          </button>

          {/* Schedules List */}
          {schedulesData?.schedules && schedulesData.schedules.length > 0 ? (
            schedulesData.schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="bg-slate-800 rounded-lg p-4"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${schedule.is_active ? 'bg-green-500/20' : 'bg-slate-700'}`}>
                      {schedule.is_active ? (
                        <Power size={20} className="text-green-400" />
                      ) : (
                        <PowerOff size={20} className="text-slate-400" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-white font-medium">
                        Schedule #{schedule.id}
                      </h3>
                      <p className="text-sm text-slate-400">
                        {schedule.is_active ? 'Active' : 'Inactive'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleScheduleMutation.mutate(schedule.id)}
                      disabled={toggleScheduleMutation.isPending}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        schedule.is_active
                          ? 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30'
                          : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                      }`}
                    >
                      {schedule.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => deleteScheduleMutation.mutate(schedule.id)}
                      disabled={deleteScheduleMutation.isPending}
                      className="p-1.5 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                {/* Schedule Times */}
                <div className="grid grid-cols-2 gap-4 mb-3">
                  <div className="p-3 bg-slate-700/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <Unlock size={16} className="text-green-400" />
                      <span className="text-sm text-slate-400">Open Time</span>
                    </div>
                    <p className="text-white font-medium">{schedule.open_time || '-'}</p>
                    {schedule.next_open && (
                      <p className="text-xs text-slate-500 mt-1">
                        Next: {format(new Date(schedule.next_open), 'MMM d, HH:mm')}
                      </p>
                    )}
                  </div>
                  <div className="p-3 bg-slate-700/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <Lock size={16} className="text-red-400" />
                      <span className="text-sm text-slate-400">Close Time</span>
                    </div>
                    <p className="text-white font-medium">{schedule.close_time || '-'}</p>
                    {schedule.next_close && (
                      <p className="text-xs text-slate-500 mt-1">
                        Next: {format(new Date(schedule.next_close), 'MMM d, HH:mm')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Groups */}
                <div className="flex flex-wrap gap-1">
                  {schedule.group_names.map((name, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded text-xs"
                    >
                      {name}
                    </span>
                  ))}
                </div>

                {/* Messages */}
                {(schedule.open_message || schedule.close_message) && (
                  <div className="mt-3 pt-3 border-t border-slate-700 text-sm">
                    {schedule.open_message && (
                      <p className="text-slate-400">
                        <span className="text-green-400">Open msg:</span> {schedule.open_message}
                      </p>
                    )}
                    {schedule.close_message && (
                      <p className="text-slate-400 mt-1">
                        <span className="text-red-400">Close msg:</span> {schedule.close_message}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="bg-slate-800 rounded-lg p-12 text-center">
              <Clock size={48} className="mx-auto mb-4 text-slate-600" />
              <h3 className="text-lg font-medium text-slate-300 mb-2">
                No Schedules Created
              </h3>
              <p className="text-slate-500">
                Create a schedule to automatically open and close groups at specific times.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Manual Control Tab */}
      {activeTab === 'manual' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {/* Optional Message */}
            <div className="bg-slate-800 rounded-lg p-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Optional Message (sent after changing settings)
              </label>
              <textarea
                value={manualMessage}
                onChange={(e) => setManualMessage(e.target.value)}
                placeholder="Optional message to send when changing group settings..."
                className="w-full h-24 px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            {/* Mention Options */}
            {manualMessage && (
              <div className="bg-slate-800 rounded-lg p-4">
                <label className="block text-sm font-medium text-slate-300 mb-3">
                  Mentions (Hidden)
                </label>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => setManualMentionType('none')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      manualMentionType === 'none'
                        ? 'bg-blue-500 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    No Mentions
                  </button>
                  <button
                    onClick={() => setManualMentionType('all')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      manualMentionType === 'all'
                        ? 'bg-blue-500 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    Mention All
                  </button>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => handleManualControl(false)}
                disabled={manualGroups.length === 0 || setSettingsNowMutation.isPending}
                className="py-4 bg-green-500/20 text-green-400 font-medium rounded-lg hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-3"
              >
                {setSettingsNowMutation.isPending ? (
                  <Loader2 size={24} className="animate-spin" />
                ) : (
                  <>
                    <Unlock size={24} />
                    <div className="text-left">
                      <p className="font-semibold">Open Groups</p>
                      <p className="text-xs opacity-75">Everyone can send</p>
                    </div>
                  </>
                )}
              </button>
              <button
                onClick={() => handleManualControl(true)}
                disabled={manualGroups.length === 0 || setSettingsNowMutation.isPending}
                className="py-4 bg-red-500/20 text-red-400 font-medium rounded-lg hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-3"
              >
                {setSettingsNowMutation.isPending ? (
                  <Loader2 size={24} className="animate-spin" />
                ) : (
                  <>
                    <Lock size={24} />
                    <div className="text-left">
                      <p className="font-semibold">Close Groups</p>
                      <p className="text-xs opacity-75">Only admins can send</p>
                    </div>
                  </>
                )}
              </button>
            </div>

            {setSettingsNowMutation.error && (
              <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 flex items-center gap-2">
                <AlertCircle size={18} />
                {(setSettingsNowMutation.error as Error).message}
              </div>
            )}
          </div>

          {/* Groups Selection */}
          {renderGroupSelector(
            manualGroups,
            toggleManualGroup,
            () => selectAllGroups(true),
            () => deselectAllGroups(true),
            manualGroupsExpanded,
            setManualGroupsExpanded
          )}
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {historyData?.history && historyData.history.length > 0 ? (
            historyData.history.map((item) => (
              <div key={item.id} className="bg-slate-800 rounded-lg p-4">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${item.action === 'open' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                      {item.action === 'open' ? (
                        <Unlock size={20} className="text-green-400" />
                      ) : (
                        <Lock size={20} className="text-red-400" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        {renderStatusBadge(item.status)}
                        <span className="text-xs text-slate-500">
                          {item.sent_at
                            ? format(new Date(item.sent_at), 'MMM d, yyyy HH:mm')
                            : item.scheduled_at
                            ? format(new Date(item.scheduled_at), 'MMM d, yyyy HH:mm')
                            : ''}
                        </span>
                      </div>
                      <p className="text-white font-medium mt-1">
                        {item.action === 'open' ? 'Opened' : 'Closed'} groups
                        {item.is_recurring && (
                          <span className="ml-2 text-xs text-blue-400">(Recurring)</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="text-sm text-slate-400">
                    {item.groups_success}/{item.groups_success + item.groups_failed} groups
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  {item.group_names.map((name, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded text-xs"
                    >
                      {name}
                    </span>
                  ))}
                </div>

                {item.message_sent && (
                  <p className="text-xs text-slate-500 mt-2">Message sent after settings change</p>
                )}

                {item.error_message && (
                  <p className="text-xs text-red-400 mt-2">
                    <AlertCircle size={12} className="inline mr-1" />
                    {item.error_message}
                  </p>
                )}
              </div>
            ))
          ) : (
            <div className="bg-slate-800 rounded-lg p-12 text-center">
              <History size={48} className="mx-auto mb-4 text-slate-600" />
              <h3 className="text-lg font-medium text-slate-300 mb-2">
                No History Yet
              </h3>
              <p className="text-slate-500">
                Settings changes will appear here.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Create Schedule Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Create Schedule</h2>
              <button
                onClick={() => { setShowCreateModal(false); resetCreateForm() }}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X size={20} className="text-slate-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Time Pickers */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    <Unlock size={16} className="inline mr-2 text-green-400" />
                    Open Time (everyone can send)
                  </label>
                  <input
                    type="time"
                    value={openTime}
                    onChange={(e) => setOpenTime(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    <Lock size={16} className="inline mr-2 text-red-400" />
                    Close Time (only admins can send)
                  </label>
                  <input
                    type="time"
                    value={closeTime}
                    onChange={(e) => setCloseTime(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Optional Messages */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Message when opening (optional)
                </label>
                <input
                  type="text"
                  value={openMessage}
                  onChange={(e) => setOpenMessage(e.target.value)}
                  placeholder="e.g., Good morning! The group is now open."
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Message when closing (optional)
                </label>
                <input
                  type="text"
                  value={closeMessage}
                  onChange={(e) => setCloseMessage(e.target.value)}
                  placeholder="e.g., Good night! Admin-only mode enabled."
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Mention Type (if messages are set) */}
              {(openMessage || closeMessage) && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Mentions (for messages)
                  </label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setMentionType('none')}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        mentionType === 'none'
                          ? 'bg-blue-500 text-white'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      No Mentions
                    </button>
                    <button
                      onClick={() => setMentionType('all')}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        mentionType === 'all'
                          ? 'bg-blue-500 text-white'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      Mention All
                    </button>
                  </div>
                </div>
              )}

              {/* Group Selector */}
              {renderGroupSelector(
                selectedGroups,
                toggleGroup,
                () => selectAllGroups(false),
                () => deselectAllGroups(false),
                groupsExpanded,
                setGroupsExpanded
              )}
            </div>

            <div className="p-4 border-t border-slate-700 flex items-center justify-between">
              <p className="text-sm text-slate-400">
                {selectedGroups.length} groups selected
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowCreateModal(false); resetCreateForm() }}
                  className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateSchedule}
                  disabled={selectedGroups.length === 0 || createScheduleMutation.isPending}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  {createScheduleMutation.isPending && (
                    <Loader2 size={16} className="animate-spin" />
                  )}
                  Create Schedule
                </button>
              </div>
            </div>

            {createScheduleMutation.error && (
              <div className="mx-4 mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 flex items-center gap-2">
                <AlertCircle size={18} />
                {(createScheduleMutation.error as Error).message}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Progress Modal */}
      {showProgressModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-md p-6">
            {settingsResult ? (
              // Completed
              <div className="text-center">
                {settingsResult.groups_failed === 0 ? (
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                    <Check size={32} className="text-green-400" />
                  </div>
                ) : settingsResult.groups_success > 0 ? (
                  <div className="w-16 h-16 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-4">
                    <AlertCircle size={32} className="text-orange-400" />
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                    <X size={32} className="text-red-400" />
                  </div>
                )}
                <h3 className="text-lg font-semibold text-white mb-2">
                  {settingsResult.groups_failed === 0
                    ? `Groups ${settingsResult.action === 'open' ? 'Opened' : 'Closed'}!`
                    : settingsResult.groups_success > 0
                    ? 'Partially Completed'
                    : 'Operation Failed'}
                </h3>
                <p className="text-slate-400 mb-4">
                  {settingsResult.groups_success} of{' '}
                  {settingsResult.groups_success + settingsResult.groups_failed} groups updated
                  successfully
                </p>
                {settingsResult.errors && settingsResult.errors.length > 0 && (
                  <div className="text-sm text-red-400 mb-4 p-3 bg-red-500/10 rounded-lg text-left">
                    {settingsResult.errors.map((err, i) => (
                      <p key={i}>{err}</p>
                    ))}
                  </div>
                )}
                <button
                  onClick={handleProgressClose}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
              // In Progress
              <div className="text-center">
                <Loader2 size={48} className="animate-spin mx-auto mb-4 text-blue-400" />
                <h3 className="text-lg font-semibold text-white mb-2">Updating Groups...</h3>
                {currentProgress ? (
                  <>
                    <p className="text-slate-400 mb-4">
                      Setting {currentProgress.action} for: {currentProgress.group_name}
                    </p>
                    <div className="w-full bg-slate-700 rounded-full h-2 mb-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all"
                        style={{
                          width: `${(currentProgress.groups_done / currentProgress.total_groups) * 100}%`,
                        }}
                      />
                    </div>
                    <p className="text-sm text-slate-500">
                      {currentProgress.groups_done} of {currentProgress.total_groups} groups
                    </p>
                  </>
                ) : (
                  <p className="text-slate-400">Preparing...</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
