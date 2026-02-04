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

type Tab = 'compose' | 'poll' | 'channels' | 'scheduled' | 'history'
type MentionType = 'none' | 'all' | 'selected'

interface Group {
  id: number
  whatsapp_group_id: string
  group_name: string
  member_count: number
  is_active: boolean
}

interface Channel {
  id: string
  name: string
  description: string
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

  // Channel state
  const [channelMode, setChannelMode] = useState<'message' | 'poll'>('message')
  const [channelContent, setChannelContent] = useState('')
  const [selectedChannels, setSelectedChannels] = useState<Channel[]>([])
  const [channelScheduleMode, setChannelScheduleMode] = useState(false)
  const [channelScheduledDateTime, setChannelScheduledDateTime] = useState('')
  const [channelsExpanded, setChannelsExpanded] = useState(true)
  const [channelSelectedMedia, setChannelSelectedMedia] = useState<File | null>(null)
  const [channelMediaPreview, setChannelMediaPreview] = useState<string | null>(null)
  const channelFileInputRef = useRef<HTMLInputElement>(null)

  // Channel poll state
  const [channelPollQuestion, setChannelPollQuestion] = useState('')
  const [channelPollOptions, setChannelPollOptions] = useState<string[]>(['', ''])
  const [channelPollAllowMultiple, setChannelPollAllowMultiple] = useState(false)

  // Channel progress state
  const [showChannelProgressModal, setShowChannelProgressModal] = useState(false)
  const [channelProgress, setChannelProgress] = useState<{ channel_name: string; channels_sent: number; total_channels: number } | null>(null)
  const [channelResult, setChannelResult] = useState<{ channels_sent: number; channels_failed: number; error_message: string | null } | null>(null)

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

  // Fetch channels
  const { data: channelsData, isLoading: channelsLoading } = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.getChannels(),
    enabled: activeTab === 'channels',
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

  // Send channel broadcast mutation (text only)
  const sendChannelBroadcastMutation = useMutation({
    mutationFn: (data: {
      content: string
      channel_ids: string[]
      channel_names: string[]
      scheduled_at?: string
    }) => api.sendChannelBroadcast(data),
    onSuccess: (result) => {
      if (!result.scheduled) {
        setShowChannelProgressModal(true)
        setChannelProgress(null)
        setChannelResult(null)
      } else {
        resetChannelForm()
        refetchScheduled()
        setActiveTab('scheduled')
      }
    },
    onError: (error) => {
      setChannelResult({
        channels_sent: 0,
        channels_failed: selectedChannels.length,
        error_message: (error as Error).message,
      })
    },
  })

  // Send channel broadcast with media mutation
  const sendChannelBroadcastWithMediaMutation = useMutation({
    mutationFn: (data: {
      media: File
      channelIds: string[]
      channelNames: string[]
      content?: string
      scheduledAt?: string
    }) =>
      api.sendChannelBroadcastWithMedia(
        data.media,
        data.channelIds,
        data.channelNames,
        data.content,
        data.scheduledAt
      ),
    onSuccess: (result) => {
      if (!result.scheduled) {
        setShowChannelProgressModal(true)
        setChannelProgress(null)
        setChannelResult(null)
      } else {
        resetChannelForm()
        refetchScheduled()
        setActiveTab('scheduled')
      }
    },
    onError: (error) => {
      setChannelResult({
        channels_sent: 0,
        channels_failed: selectedChannels.length,
        error_message: (error as Error).message,
      })
    },
  })

  // Send channel poll mutation
  const sendChannelPollMutation = useMutation({
    mutationFn: (data: {
      question: string
      options: string[]
      allow_multiple_answers: boolean
      channel_ids: string[]
      channel_names: string[]
      scheduled_at?: string
    }) => api.sendChannelPollBroadcast(data),
    onSuccess: (result) => {
      if (!result.scheduled) {
        setShowChannelProgressModal(true)
        setChannelProgress(null)
        setChannelResult(null)
      } else {
        resetChannelForm()
        refetchScheduled()
        setActiveTab('scheduled')
      }
    },
    onError: (error) => {
      setChannelResult({
        channels_sent: 0,
        channels_failed: selectedChannels.length,
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

    const unsubChannelProgress = subscribe('channel_broadcast_progress', (data) => {
      const progress = data as unknown as { channel_name: string; channels_sent: number; total_channels: number }
      setChannelProgress(progress)
    })

    const unsubChannelComplete = subscribe('channel_broadcast_complete', (data) => {
      const result = data as unknown as { channels_sent: number; channels_failed: number; error_message: string | null }
      setChannelResult(result)
      setChannelProgress(null)
    })

    const unsubChannelPollProgress = subscribe('channel_poll_progress', (data) => {
      const progress = data as unknown as { channel_name: string; channels_sent: number; total_channels: number }
      setChannelProgress(progress)
    })

    const unsubChannelPollComplete = subscribe('channel_poll_complete', (data) => {
      const result = data as unknown as { channels_sent: number; channels_failed: number; error_message: string | null }
      setChannelResult(result)
      setChannelProgress(null)
    })

    return () => {
      unsubProgress()
      unsubComplete()
      unsubPollProgress()
      unsubPollComplete()
      unsubChannelProgress()
      unsubChannelComplete()
      unsubChannelPollProgress()
      unsubChannelPollComplete()
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

  // Reset channel form
  const resetChannelForm = () => {
    setChannelMode('message')
    setChannelContent('')
    setSelectedChannels([])
    setChannelScheduleMode(false)
    setChannelScheduledDateTime('')
    setChannelSelectedMedia(null)
    setChannelMediaPreview(null)
    if (channelFileInputRef.current) {
      channelFileInputRef.current.value = ''
    }
    // Reset poll state
    setChannelPollQuestion('')
    setChannelPollOptions(['', ''])
    setChannelPollAllowMultiple(false)
  }

  // Channel poll helper functions
  const addChannelPollOption = () => {
    if (channelPollOptions.length < 12) {
      setChannelPollOptions([...channelPollOptions, ''])
    }
  }

  const removeChannelPollOption = (index: number) => {
    if (channelPollOptions.length > 2) {
      setChannelPollOptions(channelPollOptions.filter((_, i) => i !== index))
    }
  }

  const updateChannelPollOption = (index: number, value: string) => {
    const newOptions = [...channelPollOptions]
    newOptions[index] = value
    setChannelPollOptions(newOptions)
  }

  // Handle send channel poll
  const handleSendChannelPoll = () => {
    const validOptions = channelPollOptions.filter(opt => opt.trim())
    if (!channelPollQuestion.trim() || validOptions.length < 2 || selectedChannels.length === 0) return

    setShowChannelProgressModal(true)
    setChannelProgress(null)
    setChannelResult(null)

    const pollData: Parameters<typeof api.sendChannelPollBroadcast>[0] = {
      question: channelPollQuestion.trim(),
      options: validOptions,
      allow_multiple_answers: channelPollAllowMultiple,
      channel_ids: selectedChannels.map((c) => c.id),
      channel_names: selectedChannels.map((c) => c.name),
    }

    if (channelScheduleMode && channelScheduledDateTime) {
      pollData.scheduled_at = new Date(channelScheduledDateTime).toISOString()
    }

    sendChannelPollMutation.mutate(pollData)
  }

  // Handle channel file selection
  const handleChannelFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setChannelSelectedMedia(file)
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = (e) => setChannelMediaPreview(e.target?.result as string)
        reader.readAsDataURL(file)
      } else {
        setChannelMediaPreview(null)
      }
    }
  }

  // Clear channel media
  const clearChannelMedia = () => {
    setChannelSelectedMedia(null)
    setChannelMediaPreview(null)
    if (channelFileInputRef.current) {
      channelFileInputRef.current.value = ''
    }
  }

  // Toggle channel selection
  const toggleChannel = (channel: Channel) => {
    setSelectedChannels((prev) =>
      prev.some((c) => c.id === channel.id)
        ? prev.filter((c) => c.id !== channel.id)
        : [...prev, channel]
    )
  }

  // Handle send channel broadcast
  const handleSendChannelBroadcast = () => {
    if (!channelContent.trim() && !channelSelectedMedia) return
    if (selectedChannels.length === 0) return

    if (channelScheduleMode && !channelScheduledDateTime) return

    const scheduledAt = channelScheduleMode
      ? new Date(channelScheduledDateTime).toISOString()
      : undefined

    if (channelSelectedMedia) {
      sendChannelBroadcastWithMediaMutation.mutate({
        media: channelSelectedMedia,
        channelIds: selectedChannels.map((c) => c.id),
        channelNames: selectedChannels.map((c) => c.name),
        content: channelContent.trim() || undefined,
        scheduledAt,
      })
    } else {
      sendChannelBroadcastMutation.mutate({
        content: channelContent.trim(),
        channel_ids: selectedChannels.map((c) => c.id),
        channel_names: selectedChannels.map((c) => c.name),
        scheduled_at: scheduledAt,
      })
    }

    if (channelScheduleMode) {
      resetChannelForm()
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
          onClick={() => setActiveTab('channels')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'channels'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted hover:text-foreground'
          }`}
        >
          <Users size={16} className="inline mr-2" />
          Channels
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

      {/* Channels Tab */}
      {activeTab === 'channels' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Message/Poll compose */}
          <div className="lg:col-span-2 space-y-4">
            {/* Mode Selector */}
            <div className="bg-surface rounded-lg p-4">
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setChannelMode('message')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    channelMode === 'message'
                      ? 'bg-primary text-white'
                      : 'bg-surface-secondary text-foreground-secondary hover:bg-surface-secondary/80'
                  }`}
                >
                  <Send size={18} />
                  Message
                </button>
                <button
                  onClick={() => setChannelMode('poll')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    channelMode === 'poll'
                      ? 'bg-primary text-white'
                      : 'bg-surface-secondary text-foreground-secondary hover:bg-surface-secondary/80'
                  }`}
                >
                  <BarChart2 size={18} />
                  Poll
                </button>
              </div>

              {channelMode === 'message' ? (
                <>
                  {/* Message content */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Message (optional if sending media)
                    </label>
                    <textarea
                      value={channelContent}
                      onChange={(e) => setChannelContent(e.target.value)}
                      placeholder="Type your message here..."
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary min-h-[150px]"
                    />
                    <div className="text-sm text-muted mt-1">{channelContent.length} characters</div>
                  </div>

                  {/* Media upload */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Attach Media (optional)
                    </label>
                    <div className="flex items-center gap-4">
                      <input
                        ref={channelFileInputRef}
                        type="file"
                        accept="image/*,video/*,application/*"
                        onChange={handleChannelFileSelect}
                        className="hidden"
                      />
                      <button
                        onClick={() => channelFileInputRef.current?.click()}
                        className="flex items-center gap-2 px-4 py-2 bg-background border border-border rounded-lg hover:bg-surface transition-colors"
                      >
                        <Paperclip size={18} />
                        {channelSelectedMedia ? 'Change File' : 'Attach File'}
                      </button>
                      {channelSelectedMedia && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-background rounded-lg">
                          {channelSelectedMedia.type.startsWith('image/') ? (
                            <Image size={18} className="text-blue-400" />
                          ) : channelSelectedMedia.type.startsWith('video/') ? (
                            <Film size={18} className="text-purple-400" />
                          ) : (
                            <FileText size={18} className="text-orange-400" />
                          )}
                          <span className="text-sm text-foreground truncate max-w-[200px]">
                            {channelSelectedMedia.name}
                          </span>
                          <button onClick={clearChannelMedia} className="text-muted hover:text-red-400">
                            <X size={18} />
                          </button>
                        </div>
                      )}
                    </div>
                    {channelMediaPreview && (
                      <img
                        src={channelMediaPreview}
                        alt="Preview"
                        className="mt-2 max-w-[200px] rounded-lg"
                      />
                    )}
                  </div>

                  {/* Scheduling */}
                  <div className="mb-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={channelScheduleMode}
                        onChange={(e) => setChannelScheduleMode(e.target.checked)}
                        className="rounded border-border text-primary focus:ring-primary"
                      />
                      <span className="text-sm text-foreground">Schedule for later</span>
                    </label>
                    {channelScheduleMode && (
                      <div className="mt-2">
                        <input
                          type="datetime-local"
                          value={channelScheduledDateTime}
                          onChange={(e) => setChannelScheduledDateTime(e.target.value)}
                          min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                          className="px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    )}
                  </div>

                  {/* Send button */}
                  <button
                    onClick={handleSendChannelBroadcast}
                    disabled={
                      ((!channelContent.trim() && !channelSelectedMedia) ||
                        selectedChannels.length === 0 ||
                        (channelScheduleMode && !channelScheduledDateTime) ||
                        sendChannelBroadcastMutation.isPending ||
                        sendChannelBroadcastWithMediaMutation.isPending)
                    }
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sendChannelBroadcastMutation.isPending || sendChannelBroadcastWithMediaMutation.isPending ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : channelScheduleMode ? (
                      <>
                        <Calendar size={20} />
                        Schedule to {selectedChannels.length} Channel{selectedChannels.length !== 1 ? 's' : ''}
                      </>
                    ) : channelSelectedMedia ? (
                      <>
                        <Send size={20} />
                        Send Media to {selectedChannels.length} Channel{selectedChannels.length !== 1 ? 's' : ''}
                      </>
                    ) : (
                      <>
                        <Send size={20} />
                        Send to {selectedChannels.length} Channel{selectedChannels.length !== 1 ? 's' : ''}
                      </>
                    )}
                  </button>
                </>
              ) : (
                <>
                  {/* Poll Question */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Poll Question
                    </label>
                    <input
                      type="text"
                      value={channelPollQuestion}
                      onChange={(e) => setChannelPollQuestion(e.target.value)}
                      placeholder="Ask your question..."
                      className="w-full px-4 py-3 bg-background border border-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  {/* Poll Options */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-foreground">
                        Options ({channelPollOptions.length}/12)
                      </label>
                      <button
                        onClick={addChannelPollOption}
                        disabled={channelPollOptions.length >= 12}
                        className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Plus size={16} />
                        Add
                      </button>
                    </div>
                    <div className="space-y-2">
                      {channelPollOptions.map((option, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <span className="text-muted text-sm w-6">{index + 1}.</span>
                          <input
                            type="text"
                            value={option}
                            onChange={(e) => updateChannelPollOption(index, e.target.value)}
                            placeholder={`Option ${index + 1}`}
                            className="flex-1 px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                          {channelPollOptions.length > 2 && (
                            <button
                              onClick={() => removeChannelPollOption(index)}
                              className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Allow Multiple Answers */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium text-foreground">
                          Allow Multiple Answers
                        </label>
                        <p className="text-xs text-muted">
                          Users can select more than one option
                        </p>
                      </div>
                      <button
                        onClick={() => setChannelPollAllowMultiple(!channelPollAllowMultiple)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          channelPollAllowMultiple ? 'bg-primary' : 'bg-surface-secondary'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            channelPollAllowMultiple ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Scheduling */}
                  <div className="mb-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={channelScheduleMode}
                        onChange={(e) => setChannelScheduleMode(e.target.checked)}
                        className="rounded border-border text-primary focus:ring-primary"
                      />
                      <span className="text-sm text-foreground">Schedule for later</span>
                    </label>
                    {channelScheduleMode && (
                      <div className="mt-2">
                        <input
                          type="datetime-local"
                          value={channelScheduledDateTime}
                          onChange={(e) => setChannelScheduledDateTime(e.target.value)}
                          min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                          className="px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    )}
                  </div>

                  {/* Send Poll Button */}
                  <button
                    onClick={handleSendChannelPoll}
                    disabled={
                      !channelPollQuestion.trim() ||
                      channelPollOptions.filter(opt => opt.trim()).length < 2 ||
                      selectedChannels.length === 0 ||
                      sendChannelPollMutation.isPending ||
                      (channelScheduleMode && !channelScheduledDateTime)
                    }
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sendChannelPollMutation.isPending ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : channelScheduleMode ? (
                      <>
                        <Calendar size={20} />
                        Schedule Poll to {selectedChannels.length} Channel{selectedChannels.length !== 1 ? 's' : ''}
                      </>
                    ) : (
                      <>
                        <BarChart2 size={20} />
                        Send Poll to {selectedChannels.length} Channel{selectedChannels.length !== 1 ? 's' : ''}
                      </>
                    )}
                  </button>
                </>
              )}

              <p className="text-xs text-muted mt-2 text-center">
                Note: Channels don't support mentions.
              </p>
            </div>
          </div>

          {/* Right: Channel selection */}
          <div className="space-y-4">
            <div className="bg-surface rounded-lg p-4">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setChannelsExpanded(!channelsExpanded)}
              >
                <h3 className="text-lg font-medium text-foreground">Your Channels</h3>
                {channelsExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </div>

              {channelsExpanded && (
                <>
                  <div className="flex gap-2 mt-4 mb-2">
                    <button
                      onClick={() => setSelectedChannels(channelsData?.channels || [])}
                      className="text-xs text-primary hover:underline"
                    >
                      Select All
                    </button>
                    <button
                      onClick={() => setSelectedChannels([])}
                      className="text-xs text-muted hover:text-foreground"
                    >
                      Deselect All
                    </button>
                  </div>

                  {channelsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 size={24} className="animate-spin text-primary" />
                    </div>
                  ) : channelsData?.channels && channelsData.channels.length > 0 ? (
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {channelsData.channels.map((channel) => (
                        <div
                          key={channel.id}
                          onClick={() => toggleChannel(channel)}
                          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                            selectedChannels.some((c) => c.id === channel.id)
                              ? 'bg-primary/10 border border-primary'
                              : 'bg-background hover:bg-surface border border-transparent'
                          }`}
                        >
                          {selectedChannels.some((c) => c.id === channel.id) ? (
                            <CheckSquare size={20} className="text-primary flex-shrink-0" />
                          ) : (
                            <Square size={20} className="text-muted flex-shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-foreground truncate">{channel.name}</p>
                            {channel.description && (
                              <p className="text-xs text-muted truncate">{channel.description}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted">
                      <Users size={48} className="mx-auto mb-2 opacity-50" />
                      <p>No channels found</p>
                      <p className="text-xs mt-1">Make sure you follow or own channels on WhatsApp</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Channel Progress Modal */}
      {showChannelProgressModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface rounded-lg p-6 max-w-md w-full mx-4">
            {channelResult ? (
              <>
                <div className="text-center">
                  {channelResult.channels_failed === 0 ? (
                    <Check size={48} className="mx-auto text-green-400 mb-4" />
                  ) : channelResult.channels_sent > 0 ? (
                    <AlertCircle size={48} className="mx-auto text-orange-400 mb-4" />
                  ) : (
                    <X size={48} className="mx-auto text-red-400 mb-4" />
                  )}
                  <h3 className="text-lg font-medium text-foreground mb-2">
                    {channelResult.channels_failed === 0
                      ? 'Broadcast Sent!'
                      : channelResult.channels_sent > 0
                      ? 'Partially Sent'
                      : 'Broadcast Failed'}
                  </h3>
                  <p className="text-muted mb-4">
                    Sent to {channelResult.channels_sent} channel{channelResult.channels_sent !== 1 ? 's' : ''}
                    {channelResult.channels_failed > 0 &&
                      `, failed: ${channelResult.channels_failed}`}
                  </p>
                  {channelResult.error_message && (
                    <p className="text-sm text-red-400 mb-4">{channelResult.error_message}</p>
                  )}
                  <button
                    onClick={() => {
                      setShowChannelProgressModal(false)
                      setChannelResult(null)
                      resetChannelForm()
                      refetchHistory()
                    }}
                    className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-center">
                  <Loader2 size={48} className="mx-auto text-primary animate-spin mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">Sending to Channels...</h3>
                  {channelProgress && (
                    <div className="space-y-2">
                      <p className="text-muted">
                        Currently sending to: {channelProgress.channel_name}
                      </p>
                      <div className="w-full bg-background rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{
                            width: `${(channelProgress.channels_sent / channelProgress.total_channels) * 100}%`,
                          }}
                        />
                      </div>
                      <p className="text-sm text-muted">
                        {channelProgress.channels_sent} / {channelProgress.total_channels} channels
                      </p>
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
                    ) : msg.task_type === 'channel_poll' ? (
                      <span className="px-2 py-0.5 bg-teal-500/20 text-teal-400 rounded text-xs font-medium">
                        Channel Poll
                      </span>
                    ) : msg.task_type === 'channel_broadcast' ? (
                      <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs font-medium">
                        Channel
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
                    {(msg.task_type === 'poll' || msg.task_type === 'channel_poll') ? `📊 ${msg.content}` : msg.content}
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
                    {(msg.task_type === 'channel_broadcast' || msg.task_type === 'channel_poll') ? (
                      msg.channel_names?.map((name, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 bg-green-500/10 text-green-400 rounded text-xs"
                        >
                          {name}
                        </span>
                      ))
                    ) : (
                      msg.group_names.map((name, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 bg-surface-secondary text-foreground-secondary rounded text-xs"
                        >
                          {name}
                        </span>
                      ))
                    )}
                  </div>
                  {msg.task_type !== 'channel_broadcast' && msg.mention_type !== 'none' && (
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
                    ) : broadcast.task_type === 'channel_poll' ? (
                      <span className="px-2 py-0.5 bg-teal-500/20 text-teal-400 rounded text-xs font-medium">
                        Channel Poll
                      </span>
                    ) : broadcast.task_type === 'channel_broadcast' ? (
                      <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs font-medium">
                        Channel
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
                    {broadcast.groups_sent}/{broadcast.groups_sent + broadcast.groups_failed} {(broadcast.task_type === 'channel_broadcast' || broadcast.task_type === 'channel_poll') ? 'channels' : 'groups'}
                  </div>
                </div>
                <p className="text-foreground mb-3">
                  {(broadcast.task_type === 'poll' || broadcast.task_type === 'channel_poll') ? `📊 ${broadcast.content}` : broadcast.content}
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
                  {(broadcast.task_type === 'channel_broadcast' || broadcast.task_type === 'channel_poll') ? (
                    broadcast.channel_names?.map((name, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 bg-green-500/10 text-green-400 rounded text-xs"
                      >
                        {name}
                      </span>
                    ))
                  ) : (
                    broadcast.group_names.map((name, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 bg-surface-secondary text-foreground-secondary rounded text-xs"
                      >
                        {name}
                      </span>
                    ))
                  )}
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
