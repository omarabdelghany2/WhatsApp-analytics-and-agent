import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { useWebSocket } from '../contexts/WebSocketContext'
import {
  Send,
  Clock,
  History,
  Check,
  X,
  Loader2,
  Users,
  AlertCircle,
  Calendar,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
  Paperclip,
  Image,
  FileText,
  Film,
} from 'lucide-react'
import { format } from 'date-fns'

type Tab = 'compose' | 'scheduled' | 'history'
type MentionType = 'none' | 'all' | 'selected'

interface Group {
  id: number
  whatsapp_group_id: string
  group_name: string
  member_count: number
  is_active: boolean
}

interface Member {
  id: string
  name: string
  phone: string
  isAdmin: boolean
}

interface BroadcastProgress {
  message_id: number
  group_name: string
  groups_sent: number
  total_groups: number
}

interface BroadcastComplete {
  message_id: number
  status: string
  groups_sent: number
  groups_failed: number
  error_message?: string
}

export default function BroadcastPage() {
  const queryClient = useQueryClient()
  const { subscribe } = useWebSocket()

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>('compose')

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Compose state
  const [content, setContent] = useState('')
  const [selectedGroups, setSelectedGroups] = useState<Group[]>([])
  const [mentionType, setMentionType] = useState<MentionType>('none')
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>([])
  const [scheduleMode, setScheduleMode] = useState(false)
  const [scheduledDateTime, setScheduledDateTime] = useState('')
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [groupsExpanded, setGroupsExpanded] = useState(true)

  // Media state
  const [selectedMedia, setSelectedMedia] = useState<File | null>(null)
  const [mediaPreview, setMediaPreview] = useState<string | null>(null)

  // Progress modal state
  const [showProgressModal, setShowProgressModal] = useState(false)
  const [currentProgress, setCurrentProgress] = useState<BroadcastProgress | null>(null)
  const [broadcastResult, setBroadcastResult] = useState<BroadcastComplete | null>(null)

  // Fetch groups
  const { data: groups } = useQuery({
    queryKey: ['groups'],
    queryFn: () => api.getGroups(),
  })

  // Fetch scheduled messages
  const { data: scheduledMessages, refetch: refetchScheduled } = useQuery({
    queryKey: ['scheduled-messages'],
    queryFn: () => api.getScheduledMessages(),
  })

  // Fetch broadcast history
  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ['broadcast-history'],
    queryFn: () => api.getBroadcastHistory(50, 0),
  })

  // Fetch members for selected groups
  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['broadcast-members', selectedGroups.map(g => g.whatsapp_group_id)],
    queryFn: async () => {
      const allMembers: Member[] = []
      const seenPhones = new Set<string>()

      for (const group of selectedGroups) {
        try {
          const response = await api.getGroupMembers(group.whatsapp_group_id)
          if (response.members) {
            for (const member of response.members) {
              if (!seenPhones.has(member.phone)) {
                seenPhones.add(member.phone)
                allMembers.push(member)
              }
            }
          }
        } catch (error) {
          console.error(`Failed to get members for group ${group.group_name}:`, error)
        }
      }

      return allMembers.sort((a, b) => a.name.localeCompare(b.name))
    },
    enabled: showMembersModal && selectedGroups.length > 0,
  })

  // Send broadcast mutation (text only)
  const sendBroadcastMutation = useMutation({
    mutationFn: (data: {
      content: string
      group_ids: number[]
      mention_type: MentionType
      mention_ids?: string[]
      scheduled_at?: string
    }) => api.sendBroadcast(data),
    onSuccess: (result) => {
      if (!result.scheduled) {
        // Immediate send - show progress modal
        setShowProgressModal(true)
        setCurrentProgress(null)
        setBroadcastResult(null)
      } else {
        // Scheduled - reset form and show success
        resetForm()
        refetchScheduled()
        setActiveTab('scheduled')
      }
    },
  })

  // Send broadcast with media mutation
  const sendBroadcastWithMediaMutation = useMutation({
    mutationFn: (data: {
      media: File
      groupIds: number[]
      content?: string
      mentionType: MentionType
      mentionIds?: string[]
      scheduledAt?: string
    }) =>
      api.sendBroadcastWithMedia(
        data.media,
        data.groupIds,
        data.content,
        data.mentionType,
        data.mentionIds,
        data.scheduledAt
      ),
    onSuccess: (result) => {
      if (!result.scheduled) {
        setShowProgressModal(true)
        setCurrentProgress(null)
        setBroadcastResult(null)
      } else {
        resetForm()
        refetchScheduled()
        setActiveTab('scheduled')
      }
    },
  })

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedMedia(file)
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = (e) => setMediaPreview(e.target?.result as string)
        reader.readAsDataURL(file)
      } else {
        setMediaPreview(null)
      }
    }
  }

  // Clear media
  const clearMedia = () => {
    setSelectedMedia(null)
    setMediaPreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Get media type icon
  const getMediaIcon = () => {
    if (!selectedMedia) return null
    if (selectedMedia.type.startsWith('image/')) return <Image size={24} className="text-blue-400" />
    if (selectedMedia.type.startsWith('video/')) return <Film size={24} className="text-purple-400" />
    return <FileText size={24} className="text-orange-400" />
  }

  // Cancel scheduled message mutation
  const cancelMutation = useMutation({
    mutationFn: (messageId: number) => api.cancelScheduledMessage(messageId),
    onSuccess: () => {
      refetchScheduled()
      refetchHistory()
    },
  })

  // Subscribe to WebSocket events
  useEffect(() => {
    const unsubProgress = subscribe('broadcast_progress', (data) => {
      const progress = data as unknown as BroadcastProgress
      setCurrentProgress(progress)
    })

    const unsubComplete = subscribe('broadcast_complete', (data) => {
      const result = data as unknown as BroadcastComplete
      setBroadcastResult(result)
      setCurrentProgress(null)
      refetchHistory()
    })

    return () => {
      unsubProgress()
      unsubComplete()
    }
  }, [subscribe, refetchHistory])

  // Reset form
  const resetForm = () => {
    setContent('')
    setSelectedGroups([])
    setMentionType('none')
    setSelectedMentionIds([])
    setScheduleMode(false)
    setScheduledDateTime('')
    setSelectedMedia(null)
    setMediaPreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Handle group selection
  const toggleGroup = (group: Group) => {
    setSelectedGroups((prev) =>
      prev.some((g) => g.id === group.id)
        ? prev.filter((g) => g.id !== group.id)
        : [...prev, group]
    )
  }

  const selectAllGroups = () => {
    if (groups) {
      setSelectedGroups(groups)
    }
  }

  const deselectAllGroups = () => {
    setSelectedGroups([])
  }

  // Handle member selection for mentions
  const toggleMember = (phone: string) => {
    setSelectedMentionIds((prev) =>
      prev.includes(phone) ? prev.filter((p) => p !== phone) : [...prev, phone]
    )
  }

  // Get minimum datetime for scheduling (now + 1 minute)
  const minDateTime = useMemo(() => {
    const now = new Date()
    now.setMinutes(now.getMinutes() + 1)
    return now.toISOString().slice(0, 16)
  }, [])

  // Handle send
  const handleSend = () => {
    if ((!content.trim() && !selectedMedia) || selectedGroups.length === 0) return

    if (selectedMedia) {
      // Send with media
      sendBroadcastWithMediaMutation.mutate({
        media: selectedMedia,
        groupIds: selectedGroups.map((g) => g.id),
        content: content.trim() || undefined,
        mentionType: mentionType,
        mentionIds: mentionType === 'selected' && selectedMentionIds.length > 0 ? selectedMentionIds : undefined,
        scheduledAt: scheduleMode && scheduledDateTime ? new Date(scheduledDateTime).toISOString() : undefined,
      })
    } else {
      // Send text only
      const data: Parameters<typeof api.sendBroadcast>[0] = {
        content: content.trim(),
        group_ids: selectedGroups.map((g) => g.id),
        mention_type: mentionType,
      }

      if (mentionType === 'selected' && selectedMentionIds.length > 0) {
        data.mention_ids = selectedMentionIds
      }

      if (scheduleMode && scheduledDateTime) {
        data.scheduled_at = new Date(scheduledDateTime).toISOString()
      }

      sendBroadcastMutation.mutate(data)
    }
  }

  // Check if sending
  const isSending = sendBroadcastMutation.isPending || sendBroadcastWithMediaMutation.isPending
  const sendError = sendBroadcastMutation.error || sendBroadcastWithMediaMutation.error

  // Handle progress modal close
  const handleProgressClose = () => {
    setShowProgressModal(false)
    setCurrentProgress(null)
    setBroadcastResult(null)
    if (broadcastResult) {
      resetForm()
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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Broadcast Messages</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-slate-700">
        <button
          onClick={() => setActiveTab('compose')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'compose'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Send size={16} className="inline mr-2" />
          Compose
        </button>
        <button
          onClick={() => setActiveTab('scheduled')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'scheduled'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Clock size={16} className="inline mr-2" />
          Scheduled ({scheduledMessages?.length || 0})
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

      {/* Compose Tab */}
      {activeTab === 'compose' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Message Composer */}
          <div className="lg:col-span-2 space-y-4">
            {/* Message Content */}
            <div className="bg-slate-800 rounded-lg p-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Message Content {selectedMedia && '(Caption)'}
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={selectedMedia ? "Add a caption (optional)..." : "Type your message here..."}
                className="w-full h-40 px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <p className="text-xs text-slate-500 mt-1">
                {content.length} characters
              </p>
            </div>

            {/* Media Upload */}
            <div className="bg-slate-800 rounded-lg p-4">
              <label className="block text-sm font-medium text-slate-300 mb-3">
                Attach Media (Optional)
              </label>

              {/* Hidden File Input */}
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"
                className="hidden"
              />

              {selectedMedia ? (
                /* Media Preview */
                <div className="p-4 bg-slate-700 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {mediaPreview ? (
                      <img src={mediaPreview} alt="Preview" className="w-16 h-16 object-cover rounded-lg" />
                    ) : (
                      <div className="w-16 h-16 bg-slate-600 rounded-lg flex items-center justify-center">
                        {getMediaIcon()}
                      </div>
                    )}
                    <div>
                      <p className="text-white font-medium truncate max-w-xs">{selectedMedia.name}</p>
                      <p className="text-sm text-slate-400">
                        {(selectedMedia.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={clearMedia}
                    className="p-2 hover:bg-slate-600 rounded-lg transition-colors"
                  >
                    <X size={20} className="text-slate-400" />
                  </button>
                </div>
              ) : (
                /* Upload Button */
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full p-6 border-2 border-dashed border-slate-600 rounded-lg hover:border-slate-500 transition-colors text-center"
                >
                  <Paperclip size={32} className="mx-auto mb-2 text-slate-400" />
                  <p className="text-slate-300 font-medium">Click to attach a file</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Images, videos, documents up to 64MB
                  </p>
                </button>
              )}
            </div>

            {/* Mention Options */}
            <div className="bg-slate-800 rounded-lg p-4">
              <label className="block text-sm font-medium text-slate-300 mb-3">
                Mentions (Hidden)
              </label>
              <p className="text-xs text-slate-500 mb-3">
                Members will get a notification with @mention, but the message will appear without visible tags.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    setMentionType('none')
                    setSelectedMentionIds([])
                  }}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    mentionType === 'none'
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  No Mentions
                </button>
                <button
                  onClick={() => {
                    setMentionType('all')
                    setSelectedMentionIds([])
                  }}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    mentionType === 'all'
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  Mention All
                </button>
                <button
                  onClick={() => {
                    if (selectedGroups.length === 0) {
                      alert('Please select at least one group first')
                      return
                    }
                    setMentionType('selected')
                    setShowMembersModal(true)
                  }}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    mentionType === 'selected'
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  Select Members
                  {selectedMentionIds.length > 0 && (
                    <span className="ml-2 bg-white/20 px-2 py-0.5 rounded-full text-sm">
                      {selectedMentionIds.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Schedule Options */}
            <div className="bg-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-slate-300">
                  Schedule for Later
                </label>
                <button
                  onClick={() => setScheduleMode(!scheduleMode)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    scheduleMode ? 'bg-blue-500' : 'bg-slate-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      scheduleMode ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              {scheduleMode && (
                <div className="flex items-center gap-3">
                  <Calendar size={20} className="text-slate-400" />
                  <input
                    type="datetime-local"
                    value={scheduledDateTime}
                    onChange={(e) => setScheduledDateTime(e.target.value)}
                    min={minDateTime}
                    className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>

            {/* Send Button */}
            <div className="flex gap-3">
              <button
                onClick={handleSend}
                disabled={
                  (!content.trim() && !selectedMedia) ||
                  selectedGroups.length === 0 ||
                  isSending ||
                  (scheduleMode && !scheduledDateTime)
                }
                className="flex-1 py-3 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isSending ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    Processing...
                  </>
                ) : scheduleMode ? (
                  <>
                    <Clock size={20} />
                    Schedule {selectedMedia ? 'Media' : 'Message'}
                  </>
                ) : (
                  <>
                    <Send size={20} />
                    Send {selectedMedia ? 'Media' : 'Now'} ({selectedGroups.length} groups)
                  </>
                )}
              </button>
            </div>

            {sendError && (
              <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 flex items-center gap-2">
                <AlertCircle size={18} />
                {(sendError as Error).message}
              </div>
            )}
          </div>

          {/* Groups Selection */}
          <div className="bg-slate-800 rounded-lg overflow-hidden">
            <div
              className="p-4 border-b border-slate-700 flex items-center justify-between cursor-pointer"
              onClick={() => setGroupsExpanded(!groupsExpanded)}
            >
              <div>
                <h3 className="font-medium text-white flex items-center gap-2">
                  <Users size={18} />
                  Select Groups
                </h3>
                <p className="text-sm text-slate-400 mt-1">
                  {selectedGroups.length} of {groups?.length || 0} selected
                </p>
              </div>
              {groupsExpanded ? (
                <ChevronUp size={20} className="text-slate-400" />
              ) : (
                <ChevronDown size={20} className="text-slate-400" />
              )}
            </div>

            {groupsExpanded && (
              <>
                <div className="p-3 border-b border-slate-700 flex gap-2">
                  <button
                    onClick={selectAllGroups}
                    className="flex-1 py-1.5 text-sm bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    onClick={deselectAllGroups}
                    className="flex-1 py-1.5 text-sm bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors"
                  >
                    Deselect All
                  </button>
                </div>

                <div className="max-h-96 overflow-y-auto">
                  {groups && groups.length > 0 ? (
                    <div className="divide-y divide-slate-700">
                      {groups.map((group) => (
                        <button
                          key={group.id}
                          onClick={() => toggleGroup(group)}
                          className="w-full p-3 flex items-center gap-3 hover:bg-slate-700/50 transition-colors text-left"
                        >
                          {selectedGroups.some((g) => g.id === group.id) ? (
                            <CheckSquare size={20} className="text-blue-400 flex-shrink-0" />
                          ) : (
                            <Square size={20} className="text-slate-500 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-white truncate">{group.group_name}</p>
                            <p className="text-xs text-slate-400">
                              {group.member_count} members
                            </p>
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
        </div>
      )}

      {/* Scheduled Tab */}
      {activeTab === 'scheduled' && (
        <div className="space-y-4">
          {scheduledMessages && scheduledMessages.length > 0 ? (
            scheduledMessages.map((msg) => (
              <div
                key={msg.id}
                className="bg-slate-800 rounded-lg p-4 flex items-start justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    {renderStatusBadge(msg.status)}
                    <span className="text-xs text-slate-500">
                      Scheduled for {format(new Date(msg.scheduled_at), 'MMM d, yyyy HH:mm')}
                    </span>
                  </div>
                  <p className="text-white mb-2">{msg.content}</p>
                  <div className="flex flex-wrap gap-1">
                    {msg.group_names.map((name, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded text-xs"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                  {msg.mention_type !== 'none' && (
                    <p className="text-xs text-slate-500 mt-2">
                      Mentions: {msg.mention_type === 'all' ? 'All members' : 'Selected members'}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => cancelMutation.mutate(msg.id)}
                  disabled={cancelMutation.isPending}
                  className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors text-sm"
                >
                  Cancel
                </button>
              </div>
            ))
          ) : (
            <div className="bg-slate-800 rounded-lg p-12 text-center">
              <Clock size={48} className="mx-auto mb-4 text-slate-600" />
              <h3 className="text-lg font-medium text-slate-300 mb-2">
                No Scheduled Messages
              </h3>
              <p className="text-slate-500">
                Schedule a message from the Compose tab to see it here.
              </p>
            </div>
          )}
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {historyData?.broadcasts && historyData.broadcasts.length > 0 ? (
            historyData.broadcasts.map((broadcast) => (
              <div key={broadcast.id} className="bg-slate-800 rounded-lg p-4">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-2">
                    {renderStatusBadge(broadcast.status)}
                    <span className="text-xs text-slate-500">
                      {broadcast.sent_at
                        ? format(new Date(broadcast.sent_at), 'MMM d, yyyy HH:mm')
                        : broadcast.scheduled_at
                        ? format(new Date(broadcast.scheduled_at), 'MMM d, yyyy HH:mm')
                        : ''}
                    </span>
                  </div>
                  <div className="text-sm text-slate-400">
                    {broadcast.groups_sent}/{broadcast.groups_sent + broadcast.groups_failed} groups
                  </div>
                </div>
                <p className="text-white mb-3">{broadcast.content}</p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {broadcast.group_names.map((name, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded text-xs"
                    >
                      {name}
                    </span>
                  ))}
                </div>
                {broadcast.error_message && (
                  <p className="text-xs text-red-400 mt-2">
                    <AlertCircle size={12} className="inline mr-1" />
                    {broadcast.error_message}
                  </p>
                )}
              </div>
            ))
          ) : (
            <div className="bg-slate-800 rounded-lg p-12 text-center">
              <History size={48} className="mx-auto mb-4 text-slate-600" />
              <h3 className="text-lg font-medium text-slate-300 mb-2">
                No Broadcast History
              </h3>
              <p className="text-slate-500">
                Sent broadcasts will appear here.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Members Selection Modal */}
      {showMembersModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Select Members</h2>
                <p className="text-sm text-slate-400">
                  Combined members from {selectedGroups.length} group(s)
                </p>
              </div>
              <button
                onClick={() => setShowMembersModal(false)}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X size={20} className="text-slate-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {membersLoading ? (
                <div className="p-8 text-center">
                  <Loader2 className="animate-spin mx-auto mb-4 text-slate-400" size={32} />
                  <p className="text-slate-400">Loading members...</p>
                </div>
              ) : membersData && membersData.length > 0 ? (
                <div className="divide-y divide-slate-700">
                  {membersData.map((member) => (
                    <button
                      key={member.id}
                      onClick={() => toggleMember(member.phone)}
                      className="w-full p-3 flex items-center gap-3 hover:bg-slate-700/50 transition-colors text-left"
                    >
                      {selectedMentionIds.includes(member.phone) ? (
                        <CheckSquare size={20} className="text-blue-400 flex-shrink-0" />
                      ) : (
                        <Square size={20} className="text-slate-500 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-white truncate">{member.name}</p>
                        <p className="text-xs text-slate-400">{member.phone}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-slate-400">
                  <Users size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No members found</p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-700 flex items-center justify-between">
              <p className="text-sm text-slate-400">
                {selectedMentionIds.length} selected
              </p>
              <button
                onClick={() => setShowMembersModal(false)}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress Modal */}
      {showProgressModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-md p-6">
            {broadcastResult ? (
              // Completed
              <div className="text-center">
                {broadcastResult.status === 'sent' ? (
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                    <Check size={32} className="text-green-400" />
                  </div>
                ) : broadcastResult.status === 'partially_sent' ? (
                  <div className="w-16 h-16 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-4">
                    <AlertCircle size={32} className="text-orange-400" />
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                    <X size={32} className="text-red-400" />
                  </div>
                )}
                <h3 className="text-lg font-semibold text-white mb-2">
                  {broadcastResult.status === 'sent'
                    ? 'Broadcast Sent!'
                    : broadcastResult.status === 'partially_sent'
                    ? 'Partially Sent'
                    : 'Broadcast Failed'}
                </h3>
                <p className="text-slate-400 mb-4">
                  {broadcastResult.groups_sent} of{' '}
                  {broadcastResult.groups_sent + broadcastResult.groups_failed} groups sent
                  successfully
                </p>
                {broadcastResult.error_message && (
                  <p className="text-sm text-red-400 mb-4 p-3 bg-red-500/10 rounded-lg">
                    {broadcastResult.error_message}
                  </p>
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
                <h3 className="text-lg font-semibold text-white mb-2">Sending Broadcast...</h3>
                {currentProgress ? (
                  <>
                    <p className="text-slate-400 mb-4">
                      Sending to: {currentProgress.group_name}
                    </p>
                    <div className="w-full bg-slate-700 rounded-full h-2 mb-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all"
                        style={{
                          width: `${
                            (currentProgress.groups_sent / currentProgress.total_groups) * 100
                          }%`,
                        }}
                      />
                    </div>
                    <p className="text-sm text-slate-500">
                      {currentProgress.groups_sent} of {currentProgress.total_groups} groups
                    </p>
                  </>
                ) : (
                  <p className="text-slate-400">Preparing to send...</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
