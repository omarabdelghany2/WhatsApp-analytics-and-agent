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
  BarChart2,
  Plus,
  Trash2,
} from 'lucide-react'
import { format } from 'date-fns'

type Tab = 'compose' | 'poll' | 'scheduled' | 'history'
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

  // Poll state
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState<string[]>(['', ''])
  const [pollAllowMultiple, setPollAllowMultiple] = useState(false)
  const [pollSelectedGroups, setPollSelectedGroups] = useState<Group[]>([])
  const [pollGroupsExpanded, setPollGroupsExpanded] = useState(true)
  const [pollMentionType, setPollMentionType] = useState<MentionType>('none')
  const [pollSelectedMentionIds, setPollSelectedMentionIds] = useState<string[]>([])
  const [pollScheduleMode, setPollScheduleMode] = useState(false)
  const [pollScheduledDateTime, setPollScheduledDateTime] = useState('')
  const [showPollMembersModal, setShowPollMembersModal] = useState(false)

  // Poll progress state
  const [showPollProgressModal, setShowPollProgressModal] = useState(false)
  const [pollProgress, setPollProgress] = useState<{ group_name: string; groups_sent: number; total_groups: number } | null>(null)
  const [pollResult, setPollResult] = useState<{ groups_sent: number; groups_failed: number; error_message: string | null } | null>(null)

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

  // Fetch members for poll selected groups
  const { data: pollMembersData, isLoading: pollMembersLoading } = useQuery({
    queryKey: ['poll-members', pollSelectedGroups.map(g => g.whatsapp_group_id)],
    queryFn: async () => {
      const allMembers: Member[] = []
      const seenPhones = new Set<string>()

      for (const group of pollSelectedGroups) {
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
    enabled: showPollMembersModal && pollSelectedGroups.length > 0,
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

  // Send poll mutation
  const sendPollMutation = useMutation({
    mutationFn: (data: {
      question: string
      options: string[]
      allow_multiple_answers: boolean
      group_ids: number[]
      mention_type?: 'none' | 'all' | 'selected'
      mention_ids?: string[]
      scheduled_at?: string
    }) => api.sendPollBroadcast(data),
    onSuccess: (result) => {
      if (result.scheduled) {
        // Scheduled - reset form and show scheduled tab
        setShowPollProgressModal(false)
        resetPollForm()
        refetchScheduled()
        setActiveTab('scheduled')
      } else {
        // Immediate send - wait for WebSocket updates
        // The WebSocket will update pollResult
      }
    },
    onError: (error) => {
      setPollResult({
        groups_sent: 0,
        groups_failed: pollSelectedGroups.length,
        error_message: (error as Error).message,
      })
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

    const unsubPollProgress = subscribe('poll_progress', (data) => {
      const progress = data as unknown as { group_name: string; groups_sent: number; total_groups: number }
      setPollProgress(progress)
    })

    const unsubPollComplete = subscribe('poll_complete', (data) => {
      const result = data as unknown as { groups_sent: number; groups_failed: number; error_message: string | null }
      setPollResult(result)
      setPollProgress(null)
    })

    return () => {
      unsubProgress()
      unsubComplete()
      unsubPollProgress()
      unsubPollComplete()
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

  // Poll helper functions
  const addPollOption = () => {
    if (pollOptions.length < 12) {
      setPollOptions([...pollOptions, ''])
    }
  }

  const removePollOption = (index: number) => {
    if (pollOptions.length > 2) {
      setPollOptions(pollOptions.filter((_, i) => i !== index))
    }
  }

  const updatePollOption = (index: number, value: string) => {
    const newOptions = [...pollOptions]
    newOptions[index] = value
    setPollOptions(newOptions)
  }

  const togglePollGroup = (group: Group) => {
    setPollSelectedGroups((prev) =>
      prev.some((g) => g.id === group.id)
        ? prev.filter((g) => g.id !== group.id)
        : [...prev, group]
    )
  }

  const selectAllPollGroups = () => {
    if (groups) {
      setPollSelectedGroups(groups)
    }
  }

  const deselectAllPollGroups = () => {
    setPollSelectedGroups([])
  }

  const resetPollForm = () => {
    setPollQuestion('')
    setPollOptions(['', ''])
    setPollAllowMultiple(false)
    setPollSelectedGroups([])
    setPollMentionType('none')
    setPollSelectedMentionIds([])
    setPollScheduleMode(false)
    setPollScheduledDateTime('')
  }

  const handleSendPoll = () => {
    const validOptions = pollOptions.filter(opt => opt.trim())
    if (!pollQuestion.trim() || validOptions.length < 2 || pollSelectedGroups.length === 0) return

    setShowPollProgressModal(true)
    setPollProgress(null)
    setPollResult(null)

    const pollData: Parameters<typeof api.sendPollBroadcast>[0] = {
      question: pollQuestion.trim(),
      options: validOptions,
      allow_multiple_answers: pollAllowMultiple,
      group_ids: pollSelectedGroups.map((g) => g.id),
      mention_type: pollMentionType,
    }

    if (pollMentionType === 'selected' && pollSelectedMentionIds.length > 0) {
      pollData.mention_ids = pollSelectedMentionIds
    }

    if (pollScheduleMode && pollScheduledDateTime) {
      pollData.scheduled_at = new Date(pollScheduledDateTime).toISOString()
    }

    sendPollMutation.mutate(pollData)
  }

  // Toggle poll member for mentions
  const togglePollMember = (phone: string) => {
    setPollSelectedMentionIds((prev) =>
      prev.includes(phone) ? prev.filter((p) => p !== phone) : [...prev, phone]
    )
  }

  const handlePollProgressClose = () => {
    setShowPollProgressModal(false)
    setPollProgress(null)
    setPollResult(null)
    if (pollResult && pollResult.groups_sent > 0) {
      resetPollForm()
    }
  }

  // Render status badge
  const renderStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-500/20 text-yellow-400',
      sending: 'bg-primary/20 text-primary',
      sent: 'bg-green-500/20 text-green-400',
      partially_sent: 'bg-orange-500/20 text-orange-400',
      failed: 'bg-red-500/20 text-red-400',
      cancelled: 'bg-muted/20 text-muted',
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.pending}`}>
        {status.replace('_', ' ')}
      </span>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground mb-6">Broadcast Messages</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-border">
        <button
          onClick={() => setActiveTab('compose')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'compose'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted hover:text-foreground'
          }`}
        >
          <Send size={16} className="inline mr-2" />
          Compose
        </button>
        <button
          onClick={() => setActiveTab('poll')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'poll'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted hover:text-foreground'
          }`}
        >
          <BarChart2 size={16} className="inline mr-2" />
          Poll
        </button>
        <button
          onClick={() => setActiveTab('scheduled')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'scheduled'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted hover:text-foreground'
          }`}
        >
          <Clock size={16} className="inline mr-2" />
          Scheduled ({scheduledMessages?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'history'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted hover:text-foreground'
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
            <div className="bg-surface rounded-lg p-4">
              <label className="block text-sm font-medium text-foreground-secondary mb-2">
                Message Content {selectedMedia && '(Caption)'}
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={selectedMedia ? "Add a caption (optional)..." : "Type your message here..."}
                className="w-full h-40 px-4 py-3 bg-surface-secondary border border-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
              <p className="text-xs text-muted mt-1">
                {content.length} characters
              </p>
            </div>

            {/* Media Upload */}
            <div className="bg-surface rounded-lg p-4">
              <label className="block text-sm font-medium text-foreground-secondary mb-3">
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
                <div className="p-4 bg-surface-secondary rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {mediaPreview ? (
                      <img src={mediaPreview} alt="Preview" className="w-16 h-16 object-cover rounded-lg" />
                    ) : (
                      <div className="w-16 h-16 bg-surface rounded-lg flex items-center justify-center">
                        {getMediaIcon()}
                      </div>
                    )}
                    <div>
                      <p className="text-foreground font-medium truncate max-w-xs">{selectedMedia.name}</p>
                      <p className="text-sm text-muted">
                        {(selectedMedia.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={clearMedia}
                    className="p-2 hover:bg-surface rounded-lg transition-colors"
                  >
                    <X size={20} className="text-muted" />
                  </button>
                </div>
              ) : (
                /* Upload Button */
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full p-6 border-2 border-dashed border-border rounded-lg hover:border-muted transition-colors text-center"
                >
                  <Paperclip size={32} className="mx-auto mb-2 text-muted" />
                  <p className="text-foreground-secondary font-medium">Click to attach a file</p>
                  <p className="text-xs text-muted mt-1">
                    Images, videos, documents up to 64MB
                  </p>
                </button>
              )}
            </div>

            {/* Mention Options */}
            <div className="bg-surface rounded-lg p-4">
              <label className="block text-sm font-medium text-foreground-secondary mb-3">
                Mentions (Hidden)
              </label>
              <p className="text-xs text-muted mb-3">
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
                      ? 'bg-primary text-white'
                      : 'bg-surface-secondary text-foreground-secondary hover:bg-surface-secondary/80'
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
                      ? 'bg-primary text-white'
                      : 'bg-surface-secondary text-foreground-secondary hover:bg-surface-secondary/80'
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
                      ? 'bg-primary text-white'
                      : 'bg-surface-secondary text-foreground-secondary hover:bg-surface-secondary/80'
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
            <div className="bg-surface rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-foreground-secondary">
                  Schedule for Later
                </label>
                <button
                  onClick={() => setScheduleMode(!scheduleMode)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    scheduleMode ? 'bg-primary' : 'bg-surface-secondary'
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
                  <Calendar size={20} className="text-muted" />
                  <input
                    type="datetime-local"
                    value={scheduledDateTime}
                    onChange={(e) => setScheduledDateTime(e.target.value)}
                    min={minDateTime}
                    className="flex-1 px-4 py-2 bg-surface-secondary border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
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
                className="flex-1 py-3 bg-primary text-white font-medium rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
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
          <div className="bg-surface rounded-lg overflow-hidden">
            <div
              className="p-4 border-b border-border flex items-center justify-between cursor-pointer"
              onClick={() => setGroupsExpanded(!groupsExpanded)}
            >
              <div>
                <h3 className="font-medium text-foreground flex items-center gap-2">
                  <Users size={18} />
                  Select Groups
                </h3>
                <p className="text-sm text-muted mt-1">
                  {selectedGroups.length} of {groups?.length || 0} selected
                </p>
              </div>
              {groupsExpanded ? (
                <ChevronUp size={20} className="text-muted" />
              ) : (
                <ChevronDown size={20} className="text-muted" />
              )}
            </div>

            {groupsExpanded && (
              <>
                <div className="p-3 border-b border-border flex gap-2">
                  <button
                    onClick={selectAllGroups}
                    className="flex-1 py-1.5 text-sm bg-surface-secondary text-foreground-secondary rounded hover:bg-surface-secondary/80 transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    onClick={deselectAllGroups}
                    className="flex-1 py-1.5 text-sm bg-surface-secondary text-foreground-secondary rounded hover:bg-surface-secondary/80 transition-colors"
                  >
                    Deselect All
                  </button>
                </div>

                <div className="max-h-96 overflow-y-auto">
                  {groups && groups.length > 0 ? (
                    <div className="divide-y divide-border">
                      {groups.map((group) => (
                        <button
                          key={group.id}
                          onClick={() => toggleGroup(group)}
                          className="w-full p-3 flex items-center gap-3 hover:bg-surface-secondary/50 transition-colors text-left"
                        >
                          {selectedGroups.some((g) => g.id === group.id) ? (
                            <CheckSquare size={20} className="text-primary flex-shrink-0" />
                          ) : (
                            <Square size={20} className="text-muted flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-foreground truncate">{group.group_name}</p>
                            <p className="text-xs text-muted">
                              {group.member_count} members
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center text-muted">
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

      {/* Poll Tab */}
      {activeTab === 'poll' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Poll Composer */}
          <div className="lg:col-span-2 space-y-4">
            {/* Poll Question */}
            <div className="bg-surface rounded-lg p-4">
              <label className="block text-sm font-medium text-foreground-secondary mb-2">
                Poll Question
              </label>
              <input
                type="text"
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                placeholder="Ask your question..."
                className="w-full px-4 py-3 bg-surface-secondary border border-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Poll Options */}
            <div className="bg-surface rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <label className="block text-sm font-medium text-foreground-secondary">
                  Options ({pollOptions.length}/12)
                </label>
                <button
                  onClick={addPollOption}
                  disabled={pollOptions.length >= 12}
                  className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus size={16} />
                  Add Option
                </button>
              </div>
              <div className="space-y-2">
                {pollOptions.map((option, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="text-muted text-sm w-6">{index + 1}.</span>
                    <input
                      type="text"
                      value={option}
                      onChange={(e) => updatePollOption(index, e.target.value)}
                      placeholder={`Option ${index + 1}`}
                      className="flex-1 px-4 py-2 bg-surface-secondary border border-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {pollOptions.length > 2 && (
                      <button
                        onClick={() => removePollOption(index)}
                        className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted mt-3">
                Minimum 2 options, maximum 12 options allowed
              </p>
            </div>

            {/* Allow Multiple Answers */}
            <div className="bg-surface rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-foreground-secondary">
                    Allow Multiple Answers
                  </label>
                  <p className="text-xs text-muted mt-1">
                    Users can select more than one option
                  </p>
                </div>
                <button
                  onClick={() => setPollAllowMultiple(!pollAllowMultiple)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    pollAllowMultiple ? 'bg-primary' : 'bg-surface-secondary'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      pollAllowMultiple ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Poll Mention Options */}
            <div className="bg-surface rounded-lg p-4">
              <label className="block text-sm font-medium text-foreground-secondary mb-3">
                Mentions (Hidden)
              </label>
              <p className="text-xs text-muted mb-3">
                Members will get a notification with @mention, but the poll will appear without visible tags.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    setPollMentionType('none')
                    setPollSelectedMentionIds([])
                  }}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    pollMentionType === 'none'
                      ? 'bg-primary text-white'
                      : 'bg-surface-secondary text-foreground-secondary hover:bg-surface-secondary/80'
                  }`}
                >
                  No Mentions
                </button>
                <button
                  onClick={() => {
                    setPollMentionType('all')
                    setPollSelectedMentionIds([])
                  }}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    pollMentionType === 'all'
                      ? 'bg-primary text-white'
                      : 'bg-surface-secondary text-foreground-secondary hover:bg-surface-secondary/80'
                  }`}
                >
                  Mention All
                </button>
                <button
                  onClick={() => {
                    if (pollSelectedGroups.length === 0) {
                      alert('Please select at least one group first')
                      return
                    }
                    setPollMentionType('selected')
                    setShowPollMembersModal(true)
                  }}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    pollMentionType === 'selected'
                      ? 'bg-primary text-white'
                      : 'bg-surface-secondary text-foreground-secondary hover:bg-surface-secondary/80'
                  }`}
                >
                  Select Members
                  {pollSelectedMentionIds.length > 0 && (
                    <span className="ml-2 bg-white/20 px-2 py-0.5 rounded-full text-sm">
                      {pollSelectedMentionIds.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Poll Schedule Options */}
            <div className="bg-surface rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-foreground-secondary">
                  Schedule for Later
                </label>
                <button
                  onClick={() => setPollScheduleMode(!pollScheduleMode)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    pollScheduleMode ? 'bg-primary' : 'bg-surface-secondary'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      pollScheduleMode ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              {pollScheduleMode && (
                <div className="flex items-center gap-3">
                  <Calendar size={20} className="text-muted" />
                  <input
                    type="datetime-local"
                    value={pollScheduledDateTime}
                    onChange={(e) => setPollScheduledDateTime(e.target.value)}
                    min={minDateTime}
                    className="flex-1 px-4 py-2 bg-surface-secondary border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}
            </div>

            {/* Send Poll Button */}
            <div className="flex gap-3">
              <button
                onClick={handleSendPoll}
                disabled={
                  !pollQuestion.trim() ||
                  pollOptions.filter(opt => opt.trim()).length < 2 ||
                  pollSelectedGroups.length === 0 ||
                  sendPollMutation.isPending ||
                  (pollScheduleMode && !pollScheduledDateTime)
                }
                className="flex-1 py-3 bg-primary text-white font-medium rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {sendPollMutation.isPending ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    Processing...
                  </>
                ) : pollScheduleMode ? (
                  <>
                    <Clock size={20} />
                    Schedule Poll ({pollSelectedGroups.length} groups)
                  </>
                ) : (
                  <>
                    <BarChart2 size={20} />
                    Send Poll ({pollSelectedGroups.length} groups)
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Groups Selection for Poll */}
          <div className="bg-surface rounded-lg overflow-hidden">
            <div
              className="p-4 border-b border-border flex items-center justify-between cursor-pointer"
              onClick={() => setPollGroupsExpanded(!pollGroupsExpanded)}
            >
              <div>
                <h3 className="font-medium text-foreground flex items-center gap-2">
                  <Users size={18} />
                  Select Groups
                </h3>
                <p className="text-sm text-muted mt-1">
                  {pollSelectedGroups.length} of {groups?.length || 0} selected
                </p>
              </div>
              {pollGroupsExpanded ? (
                <ChevronUp size={20} className="text-muted" />
              ) : (
                <ChevronDown size={20} className="text-muted" />
              )}
            </div>

            {pollGroupsExpanded && (
              <>
                <div className="p-3 border-b border-border flex gap-2">
                  <button
                    onClick={selectAllPollGroups}
                    className="flex-1 py-1.5 text-sm bg-surface-secondary text-foreground-secondary rounded hover:bg-surface-secondary/80 transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    onClick={deselectAllPollGroups}
                    className="flex-1 py-1.5 text-sm bg-surface-secondary text-foreground-secondary rounded hover:bg-surface-secondary/80 transition-colors"
                  >
                    Deselect All
                  </button>
                </div>

                <div className="max-h-96 overflow-y-auto">
                  {groups && groups.length > 0 ? (
                    <div className="divide-y divide-border">
                      {groups.map((group) => (
                        <button
                          key={group.id}
                          onClick={() => togglePollGroup(group)}
                          className="w-full p-3 flex items-center gap-3 hover:bg-surface-secondary/50 transition-colors text-left"
                        >
                          {pollSelectedGroups.some((g) => g.id === group.id) ? (
                            <CheckSquare size={20} className="text-primary flex-shrink-0" />
                          ) : (
                            <Square size={20} className="text-muted flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-foreground truncate">{group.group_name}</p>
                            <p className="text-xs text-muted">
                              {group.member_count} members
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center text-muted">
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
                className="bg-surface rounded-lg p-4 flex items-start justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    {renderStatusBadge(msg.status)}
                    {msg.task_type === 'poll' ? (
                      <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs font-medium">
                        Poll
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs font-medium">
                        Broadcast
                      </span>
                    )}
                    <span className="text-xs text-muted">
                      Scheduled for {format(new Date(msg.scheduled_at), 'MMM d, yyyy HH:mm')}
                    </span>
                  </div>
                  <p className="text-foreground mb-2">
                    {msg.task_type === 'poll' ? `📊 ${msg.content}` : msg.content}
                  </p>
                  {msg.poll_options && (
                    <div className="mb-2 space-y-1">
                      {msg.poll_options.slice(0, 3).map((opt, i) => (
                        <p key={i} className="text-sm text-muted">• {opt}</p>
                      ))}
                      {msg.poll_options.length > 3 && (
                        <p className="text-xs text-muted">+{msg.poll_options.length - 3} more options</p>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {msg.group_names.map((name, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 bg-surface-secondary text-foreground-secondary rounded text-xs"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                  {msg.mention_type !== 'none' && (
                    <p className="text-xs text-muted mt-2">
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
            <div className="bg-surface rounded-lg p-12 text-center">
              <Clock size={48} className="mx-auto mb-4 text-muted" />
              <h3 className="text-lg font-medium text-foreground-secondary mb-2">
                No Scheduled Messages
              </h3>
              <p className="text-muted">
                Schedule a message from the Compose or Poll tab to see it here.
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
              <div key={broadcast.id} className="bg-surface rounded-lg p-4">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-2">
                    {renderStatusBadge(broadcast.status)}
                    {broadcast.task_type === 'poll' ? (
                      <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs font-medium">
                        Poll
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs font-medium">
                        Broadcast
                      </span>
                    )}
                    <span className="text-xs text-muted">
                      {broadcast.sent_at
                        ? format(new Date(broadcast.sent_at), 'MMM d, yyyy HH:mm')
                        : broadcast.scheduled_at
                        ? format(new Date(broadcast.scheduled_at), 'MMM d, yyyy HH:mm')
                        : ''}
                    </span>
                  </div>
                  <div className="text-sm text-muted">
                    {broadcast.groups_sent}/{broadcast.groups_sent + broadcast.groups_failed} groups
                  </div>
                </div>
                <p className="text-foreground mb-3">
                  {broadcast.task_type === 'poll' ? `📊 ${broadcast.content}` : broadcast.content}
                </p>
                {broadcast.poll_options && (
                  <div className="mb-3 space-y-1">
                    {broadcast.poll_options.slice(0, 3).map((opt, i) => (
                      <p key={i} className="text-sm text-muted">• {opt}</p>
                    ))}
                    {broadcast.poll_options.length > 3 && (
                      <p className="text-xs text-muted">+{broadcast.poll_options.length - 3} more options</p>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-1 mb-2">
                  {broadcast.group_names.map((name, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 bg-surface-secondary text-foreground-secondary rounded text-xs"
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
            <div className="bg-surface rounded-lg p-12 text-center">
              <History size={48} className="mx-auto mb-4 text-muted" />
              <h3 className="text-lg font-medium text-foreground-secondary mb-2">
                No Broadcast History
              </h3>
              <p className="text-muted">
                Sent broadcasts and polls will appear here.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Members Selection Modal */}
      {showMembersModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Select Members</h2>
                <p className="text-sm text-muted">
                  Combined members from {selectedGroups.length} group(s)
                </p>
              </div>
              <button
                onClick={() => setShowMembersModal(false)}
                className="p-2 hover:bg-surface-secondary rounded-lg transition-colors"
              >
                <X size={20} className="text-muted" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {membersLoading ? (
                <div className="p-8 text-center">
                  <Loader2 className="animate-spin mx-auto mb-4 text-muted" size={32} />
                  <p className="text-muted">Loading members...</p>
                </div>
              ) : membersData && membersData.length > 0 ? (
                <div className="divide-y divide-border">
                  {membersData.map((member) => (
                    <button
                      key={member.id}
                      onClick={() => toggleMember(member.phone)}
                      className="w-full p-3 flex items-center gap-3 hover:bg-surface-secondary/50 transition-colors text-left"
                    >
                      {selectedMentionIds.includes(member.phone) ? (
                        <CheckSquare size={20} className="text-primary flex-shrink-0" />
                      ) : (
                        <Square size={20} className="text-muted flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground truncate">{member.name}</p>
                        <p className="text-xs text-muted">{member.phone}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted">
                  <Users size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No members found</p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border flex items-center justify-between">
              <p className="text-sm text-muted">
                {selectedMentionIds.length} selected
              </p>
              <button
                onClick={() => setShowMembersModal(false)}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
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
          <div className="bg-surface rounded-lg border border-border w-full max-w-md p-6">
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
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {broadcastResult.status === 'sent'
                    ? 'Broadcast Sent!'
                    : broadcastResult.status === 'partially_sent'
                    ? 'Partially Sent'
                    : 'Broadcast Failed'}
                </h3>
                <p className="text-muted mb-4">
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
                  className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
              // In Progress
              <div className="text-center">
                <Loader2 size={48} className="animate-spin mx-auto mb-4 text-primary" />
                <h3 className="text-lg font-semibold text-foreground mb-2">Sending Broadcast...</h3>
                {currentProgress ? (
                  <>
                    <p className="text-muted mb-4">
                      Sending to: {currentProgress.group_name}
                    </p>
                    <div className="w-full bg-surface-secondary rounded-full h-2 mb-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{
                          width: `${
                            (currentProgress.groups_sent / currentProgress.total_groups) * 100
                          }%`,
                        }}
                      />
                    </div>
                    <p className="text-sm text-muted">
                      {currentProgress.groups_sent} of {currentProgress.total_groups} groups
                    </p>
                  </>
                ) : (
                  <p className="text-muted">Preparing to send...</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Poll Progress Modal */}
      {showPollProgressModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md p-6">
            {pollResult ? (
              // Completed
              <div className="text-center">
                {pollResult.groups_sent > 0 && pollResult.groups_failed === 0 ? (
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                    <Check size={32} className="text-green-400" />
                  </div>
                ) : pollResult.groups_sent > 0 ? (
                  <div className="w-16 h-16 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-4">
                    <AlertCircle size={32} className="text-orange-400" />
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                    <X size={32} className="text-red-400" />
                  </div>
                )}
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {pollResult.groups_sent > 0 && pollResult.groups_failed === 0
                    ? 'Poll Sent!'
                    : pollResult.groups_sent > 0
                    ? 'Poll Partially Sent'
                    : 'Poll Failed'}
                </h3>
                <p className="text-muted mb-4">
                  {pollResult.groups_sent} of{' '}
                  {pollResult.groups_sent + pollResult.groups_failed} groups sent
                  successfully
                </p>
                {pollResult.error_message && (
                  <p className="text-sm text-red-400 mb-4 p-3 bg-red-500/10 rounded-lg">
                    {pollResult.error_message}
                  </p>
                )}
                <button
                  onClick={handlePollProgressClose}
                  className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
              // In Progress
              <div className="text-center">
                <Loader2 size={48} className="animate-spin mx-auto mb-4 text-primary" />
                <h3 className="text-lg font-semibold text-foreground mb-2">Sending Poll...</h3>
                {pollProgress ? (
                  <>
                    <p className="text-muted mb-4">
                      Sending to: {pollProgress.group_name}
                    </p>
                    <div className="w-full bg-surface-secondary rounded-full h-2 mb-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{
                          width: `${
                            (pollProgress.groups_sent / pollProgress.total_groups) * 100
                          }%`,
                        }}
                      />
                    </div>
                    <p className="text-sm text-muted">
                      {pollProgress.groups_sent} of {pollProgress.total_groups} groups
                    </p>
                  </>
                ) : (
                  <p className="text-muted">Preparing to send...</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Poll Members Selection Modal */}
      {showPollMembersModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Select Members for Poll</h2>
                <p className="text-sm text-muted">
                  Combined members from {pollSelectedGroups.length} group(s)
                </p>
              </div>
              <button
                onClick={() => setShowPollMembersModal(false)}
                className="p-2 hover:bg-surface-secondary rounded-lg transition-colors"
              >
                <X size={20} className="text-muted" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {pollMembersLoading ? (
                <div className="p-8 text-center">
                  <Loader2 className="animate-spin mx-auto mb-4 text-muted" size={32} />
                  <p className="text-muted">Loading members...</p>
                </div>
              ) : pollMembersData && pollMembersData.length > 0 ? (
                <div className="divide-y divide-border">
                  {pollMembersData.map((member) => (
                    <button
                      key={member.id}
                      onClick={() => togglePollMember(member.phone)}
                      className="w-full p-3 flex items-center gap-3 hover:bg-surface-secondary/50 transition-colors text-left"
                    >
                      {pollSelectedMentionIds.includes(member.phone) ? (
                        <CheckSquare size={20} className="text-primary flex-shrink-0" />
                      ) : (
                        <Square size={20} className="text-muted flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground truncate">{member.name}</p>
                        <p className="text-xs text-muted">{member.phone}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted">
                  <Users size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No members found</p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border flex items-center justify-between">
              <p className="text-sm text-muted">
                {pollSelectedMentionIds.length} selected
              </p>
              <button
                onClick={() => setShowPollMembersModal(false)}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
