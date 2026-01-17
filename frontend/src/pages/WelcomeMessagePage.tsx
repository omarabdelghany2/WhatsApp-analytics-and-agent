import { useState, useRef, useMemo } from 'react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import {
  MessageSquare,
  Users,
  Settings,
  Check,
  X,
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
  Image as ImageIcon,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
  Upload,
  RefreshCw,
  Power,
  PowerOff,
  UserPlus,
} from 'lucide-react'

interface GroupMember {
  id: string
  name: string
  phone: string
  isAdmin: boolean
}

interface WelcomeGroup {
  id: number
  group_name: string
  whatsapp_group_id: string
  welcome_enabled: boolean
  welcome_threshold: number
  welcome_join_count: number
  welcome_text: string | null
  welcome_extra_mentions?: string[] | null
  welcome_part2_enabled: boolean
  welcome_part2_text: string | null
  welcome_part2_image: string | null
}

export default function WelcomeMessagePage() {
  const queryClient = useQueryClient()

  // Modal state
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [selectedGroups, setSelectedGroups] = useState<number[]>([])
  const [groupsExpanded, setGroupsExpanded] = useState(true)

  // Welcome settings form state
  const [enabled, setEnabled] = useState(true)
  const [threshold, setThreshold] = useState(1)
  const [welcomeText, setWelcomeText] = useState('')
  const [selectedMemberPhones, setSelectedMemberPhones] = useState<string[]>([])
  const [part2Enabled, setPart2Enabled] = useState(false)
  const [part2Text, setPart2Text] = useState('')
  const [selectedImage, setSelectedImage] = useState<File | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch welcome settings - must be declared first as other hooks depend on it
  const { data: welcomeData, isLoading, refetch } = useQuery({
    queryKey: ['welcome-settings'],
    queryFn: () => api.getWelcomeSettings(),
  })

  // Get whatsapp group IDs for selected groups
  const selectedWhatsappGroupIds = useMemo(() => {
    if (!welcomeData?.groups) return []
    return selectedGroups
      .map(id => welcomeData.groups.find(g => g.id === id)?.whatsapp_group_id)
      .filter((id): id is string => !!id)
  }, [selectedGroups, welcomeData?.groups])

  // Fetch members for all selected groups
  const membersQueries = useQueries({
    queries: selectedWhatsappGroupIds.map(groupId => ({
      queryKey: ['group-members', groupId],
      queryFn: () => api.getGroupMembers(groupId),
      enabled: selectedGroups.length > 0,
    })),
  })

  // Calculate common members across all selected groups
  const { commonMembers, membersLoading } = useMemo(() => {
    const loading = membersQueries.some(q => q.isLoading)
    if (loading || membersQueries.length === 0) {
      return { commonMembers: [], membersLoading: loading }
    }

    // Get members from each group
    const allGroupMembers = membersQueries
      .map(q => q.data?.members || [])
      .filter(members => members.length > 0)

    if (allGroupMembers.length === 0) {
      return { commonMembers: [], membersLoading: false }
    }

    // For single group, return all members
    if (allGroupMembers.length === 1) {
      return { commonMembers: allGroupMembers[0], membersLoading: false }
    }

    // Find intersection by phone number
    const firstGroupPhones = new Set(allGroupMembers[0].map(m => m.phone))

    // Keep only phones that exist in ALL groups
    for (let i = 1; i < allGroupMembers.length; i++) {
      const groupPhones = new Set(allGroupMembers[i].map(m => m.phone))
      for (const phone of firstGroupPhones) {
        if (!groupPhones.has(phone)) {
          firstGroupPhones.delete(phone)
        }
      }
    }

    // Return members from first group that are common to all
    const common = allGroupMembers[0].filter(m => firstGroupPhones.has(m.phone))
    return { commonMembers: common, membersLoading: false }
  }, [membersQueries])

  // Bulk update mutation
  const updateBulkMutation = useMutation({
    mutationFn: (data: {
      group_ids: number[]
      enabled: boolean
      threshold?: number
      text?: string
      extra_mentions?: string[]
      part2_enabled?: boolean
      part2_text?: string
    }) => api.updateWelcomeSettingsBulk(data),
    onSuccess: () => {
      setShowConfigModal(false)
      resetForm()
      refetch()
    },
  })

  // Upload image mutation
  const uploadImageMutation = useMutation({
    mutationFn: ({ groupIds, image }: { groupIds: number[]; image: File }) =>
      api.uploadWelcomeImage(groupIds, image),
    onSuccess: () => {
      refetch()
    },
  })

  // Reset counter mutation
  const resetCounterMutation = useMutation({
    mutationFn: (groupId: number) => api.resetWelcomeCounter(groupId),
    onSuccess: () => {
      refetch()
    },
  })

  // Delete image mutation
  const deleteImageMutation = useMutation({
    mutationFn: (groupId: number) => api.deleteWelcomeImage(groupId),
    onSuccess: () => {
      refetch()
    },
  })

  // Disable all mutation
  const disableAllMutation = useMutation({
    mutationFn: () => api.disableAllWelcomeMessages(),
    onSuccess: () => {
      refetch()
    },
  })

  // Reset form
  const resetForm = () => {
    setSelectedGroups([])
    setEnabled(true)
    setThreshold(1)
    setWelcomeText('')
    setSelectedMemberPhones([])
    setPart2Enabled(false)
    setPart2Text('')
    setSelectedImage(null)
  }

  // Edit a specific group - pre-populate form with its settings
  const editGroup = (group: WelcomeGroup) => {
    setSelectedGroups([group.id])
    setEnabled(group.welcome_enabled)
    setThreshold(group.welcome_threshold || 1)
    setWelcomeText(group.welcome_text || '')
    setSelectedMemberPhones(group.welcome_extra_mentions || [])
    setPart2Enabled(group.welcome_part2_enabled || false)
    setPart2Text(group.welcome_part2_text || '')
    setSelectedImage(null) // Can't pre-load existing image file
    setShowConfigModal(true)
  }

  // Toggle member selection
  const toggleMember = (phone: string) => {
    setSelectedMemberPhones(prev =>
      prev.includes(phone)
        ? prev.filter(p => p !== phone)
        : [...prev, phone]
    )
  }

  // Handle group selection
  const toggleGroup = (groupId: number) => {
    setSelectedGroups((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId]
    )
  }

  const selectAllGroups = () => {
    if (welcomeData?.groups) {
      setSelectedGroups(welcomeData.groups.map((g) => g.id))
    }
  }

  const deselectAllGroups = () => {
    setSelectedGroups([])
  }

  // Handle save
  const handleSave = async () => {
    if (selectedGroups.length === 0) return

    await updateBulkMutation.mutateAsync({
      group_ids: selectedGroups,
      enabled,
      threshold,
      text: welcomeText || undefined,
      extra_mentions: selectedMemberPhones.length > 0 ? selectedMemberPhones : undefined,
      part2_enabled: part2Enabled,
      part2_text: part2Text || undefined,
    })

    // Upload image if selected
    if (selectedImage && selectedGroups.length > 0) {
      await uploadImageMutation.mutateAsync({
        groupIds: selectedGroups,
        image: selectedImage,
      })
    }
  }

  // Handle image select
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedImage(file)
    }
  }

  // Count enabled groups
  const enabledCount = welcomeData?.groups?.filter((g) => g.welcome_enabled).length || 0
  const totalGroups = welcomeData?.groups?.length || 0

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Welcome Messages</h1>
          <p className="text-muted mt-1">
            Automatically welcome new members when they join groups
          </p>
        </div>
        <div className="flex gap-3">
          {enabledCount > 0 && (
            <button
              onClick={() => disableAllMutation.mutate()}
              disabled={disableAllMutation.isPending}
              className="px-4 py-2 bg-orange-500/20 text-orange-400 rounded-lg hover:bg-orange-500/30 transition-colors flex items-center gap-2"
            >
              {disableAllMutation.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <PowerOff size={16} />
              )}
              Disable All
            </button>
          )}
          <button
            onClick={() => setShowConfigModal(true)}
            className="px-4 py-2 bg-primary text-foreground rounded-lg hover:bg-primary-hover transition-colors flex items-center gap-2"
          >
            <Settings size={16} />
            Configure
          </button>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-surface rounded-lg p-4">
          <div className="flex items-center gap-2 text-muted mb-1">
            <Users size={16} />
            <span className="text-sm">Total Groups</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{totalGroups}</p>
        </div>
        <div className="bg-surface rounded-lg p-4">
          <div className="flex items-center gap-2 text-green-400 mb-1">
            <Power size={16} />
            <span className="text-sm">Enabled</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{enabledCount}</p>
        </div>
        <div className="bg-surface rounded-lg p-4">
          <div className="flex items-center gap-2 text-muted mb-1">
            <PowerOff size={16} />
            <span className="text-sm">Disabled</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{totalGroups - enabledCount}</p>
        </div>
        <div className="bg-surface rounded-lg p-4">
          <div className="flex items-center gap-2 text-primary mb-1">
            <MessageSquare size={16} />
            <span className="text-sm">Pending Joins</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {welcomeData?.groups?.reduce((sum, g) => sum + g.welcome_join_count, 0) || 0}
          </p>
        </div>
      </div>

      {/* Groups List */}
      {isLoading ? (
        <div className="bg-surface rounded-lg p-12 text-center">
          <Loader2 size={48} className="mx-auto mb-4 text-primary animate-spin" />
          <p className="text-muted">Loading welcome settings...</p>
        </div>
      ) : welcomeData?.groups && welcomeData.groups.length > 0 ? (
        <div className="space-y-4">
          {welcomeData.groups.map((group) => (
            <div
              key={group.id}
              className="bg-surface rounded-lg p-4"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${group.welcome_enabled ? 'bg-green-500/20' : 'bg-surface-secondary'}`}>
                    {group.welcome_enabled ? (
                      <Power size={20} className="text-green-400" />
                    ) : (
                      <PowerOff size={20} className="text-muted" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-foreground font-medium">{group.group_name}</h3>
                    <p className="text-sm text-muted">
                      {group.welcome_enabled ? 'Welcome message enabled' : 'Disabled'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => editGroup(group)}
                    className="px-3 py-1.5 bg-primary/20 text-primary rounded-lg hover:bg-primary/30 transition-colors flex items-center gap-1 text-sm"
                  >
                    <Settings size={14} />
                    Edit
                  </button>
                  {group.welcome_enabled && group.welcome_join_count > 0 && (
                    <button
                      onClick={() => resetCounterMutation.mutate(group.id)}
                      disabled={resetCounterMutation.isPending}
                      className="px-3 py-1.5 bg-surface-secondary text-foreground-secondary rounded-lg hover:bg-surface-secondary/80 transition-colors flex items-center gap-1 text-sm"
                    >
                      <RefreshCw size={14} />
                      Reset
                    </button>
                  )}
                  {group.welcome_part2_image && (
                    <button
                      onClick={() => deleteImageMutation.mutate(group.id)}
                      disabled={deleteImageMutation.isPending}
                      className="p-1.5 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                      title="Delete welcome image"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              {group.welcome_enabled && (
                <>
                  {/* Settings Info */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
                    <div className="p-2 bg-surface-secondary/50 rounded-lg">
                      <p className="text-xs text-muted">Threshold</p>
                      <p className="text-foreground font-medium">{group.welcome_threshold} joins</p>
                    </div>
                    <div className="p-2 bg-surface-secondary/50 rounded-lg">
                      <p className="text-xs text-muted">Current Count</p>
                      <p className="text-foreground font-medium">
                        {group.welcome_join_count}/{group.welcome_threshold}
                      </p>
                    </div>
                    <div className="p-2 bg-surface-secondary/50 rounded-lg">
                      <p className="text-xs text-muted">Extra Mentions</p>
                      <p className="text-foreground font-medium">
                        {group.welcome_extra_mentions?.length || 0}
                      </p>
                    </div>
                    <div className="p-2 bg-surface-secondary/50 rounded-lg">
                      <p className="text-xs text-muted">Part 2</p>
                      <p className="text-foreground font-medium">
                        {group.welcome_part2_enabled ? 'Enabled' : 'Disabled'}
                      </p>
                    </div>
                    <div className="p-2 bg-surface-secondary/50 rounded-lg">
                      <p className="text-xs text-muted">Image</p>
                      <p className="text-foreground font-medium flex items-center gap-1">
                        {group.welcome_part2_image ? (
                          <>
                            <ImageIcon size={14} className="text-green-400" />
                            Set
                          </>
                        ) : (
                          'None'
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Welcome Text Preview */}
                  {group.welcome_text && (
                    <div className="p-3 bg-surface-secondary/30 rounded-lg">
                      <p className="text-xs text-muted mb-1">Welcome Text (Part 1)</p>
                      <p className="text-foreground-secondary text-sm">{group.welcome_text}</p>
                    </div>
                  )}

                  {/* Part 2 Text Preview */}
                  {group.welcome_part2_enabled && group.welcome_part2_text && (
                    <div className="mt-2 p-3 bg-surface-secondary/30 rounded-lg">
                      <p className="text-xs text-muted mb-1">Part 2 Text</p>
                      <p className="text-foreground-secondary text-sm">{group.welcome_part2_text}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-surface rounded-lg p-12 text-center">
          <MessageSquare size={48} className="mx-auto mb-4 text-muted" />
          <h3 className="text-lg font-medium text-foreground-secondary mb-2">
            No Groups Found
          </h3>
          <p className="text-muted">
            Add groups to your monitored list first.
          </p>
        </div>
      )}

      {/* Configuration Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Configure Welcome Message</h2>
              <button
                onClick={() => { setShowConfigModal(false); resetForm() }}
                className="p-2 hover:bg-surface-secondary rounded-lg transition-colors"
              >
                <X size={20} className="text-muted" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Enable/Disable Toggle */}
              <div className="bg-surface-secondary/50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-foreground">Enable Welcome Messages</h3>
                    <p className="text-sm text-muted">
                      Automatically send welcome messages when members join
                    </p>
                  </div>
                  <button
                    onClick={() => setEnabled(!enabled)}
                    className={`w-14 h-8 rounded-full transition-colors ${
                      enabled ? 'bg-green-500' : 'bg-surface-secondary'
                    }`}
                  >
                    <div
                      className={`w-6 h-6 bg-white rounded-full transition-transform mx-1 ${
                        enabled ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {enabled && (
                <>
                  {/* Threshold */}
                  <div>
                    <label className="block text-sm font-medium text-foreground-secondary mb-2">
                      Join Threshold
                    </label>
                    <p className="text-xs text-muted mb-2">
                      Number of consecutive joins before sending welcome message
                    </p>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={threshold}
                      onChange={(e) => setThreshold(parseInt(e.target.value) || 1)}
                      className="w-full px-4 py-2 bg-surface-secondary border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  {/* Part 1: Welcome Text */}
                  <div>
                    <label className="block text-sm font-medium text-foreground-secondary mb-2">
                      Part 1: Welcome Text
                    </label>
                    <p className="text-xs text-muted mb-2">
                      This text will be sent along with mentions of new joiners
                    </p>
                    <textarea
                      value={welcomeText}
                      onChange={(e) => setWelcomeText(e.target.value)}
                      placeholder="Welcome to the group! Please read the pinned message."
                      className="w-full h-24 px-4 py-3 bg-surface-secondary border border-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                    />
                  </div>

                  {/* Extra Mentions - Member Selector */}
                  <div>
                    <label className="block text-sm font-medium text-foreground-secondary mb-2">
                      <UserPlus size={16} className="inline mr-2" />
                      Extra Mentions (Optional)
                    </label>
                    <p className="text-xs text-muted mb-2">
                      {selectedGroups.length > 1
                        ? `Select common members across ${selectedGroups.length} groups to mention`
                        : 'Select members to mention at the end of the welcome message'}
                    </p>

                    {selectedGroups.length > 0 ? (
                      <div className="bg-surface-secondary/50 rounded-lg border border-border overflow-hidden">
                        {membersLoading ? (
                          <div className="p-4 text-center">
                            <Loader2 size={20} className="animate-spin mx-auto text-primary" />
                            <p className="text-sm text-muted mt-2">Loading members...</p>
                          </div>
                        ) : commonMembers.length > 0 ? (
                          <div className="max-h-48 overflow-y-auto">
                            {commonMembers.map((member) => (
                              <button
                                key={member.id}
                                type="button"
                                onClick={() => toggleMember(member.phone)}
                                className="w-full p-3 flex items-center gap-3 hover:bg-surface-secondary/80/50 transition-colors text-left border-b border-border last:border-b-0"
                              >
                                {selectedMemberPhones.includes(member.phone) ? (
                                  <CheckSquare size={18} className="text-primary flex-shrink-0" />
                                ) : (
                                  <Square size={18} className="text-muted flex-shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-foreground text-sm truncate">
                                    {member.name}
                                    {member.isAdmin && (
                                      <span className="ml-2 text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">
                                        Admin
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-xs text-muted">{member.phone}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 text-center text-muted">
                            <Users size={24} className="mx-auto mb-2 opacity-50" />
                            <p className="text-sm">
                              {selectedGroups.length > 1
                                ? 'No common members found across selected groups'
                                : 'No members found'}
                            </p>
                          </div>
                        )}

                        {selectedMemberPhones.length > 0 && (
                          <div className="p-2 bg-surface-secondary/30 border-t border-border">
                            <p className="text-xs text-muted">
                              {selectedMemberPhones.length} member(s) selected
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-4 bg-surface-secondary/30 rounded-lg text-center text-muted">
                        <Users size={24} className="mx-auto mb-2 opacity-50" />
                        <p className="text-sm">Select groups to see available members</p>
                      </div>
                    )}
                  </div>

                  {/* Part 2 Toggle */}
                  <div className="bg-surface-secondary/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-foreground">Enable Part 2</h3>
                        <p className="text-sm text-muted">
                          Send a second message with text and/or image
                        </p>
                      </div>
                      <button
                        onClick={() => setPart2Enabled(!part2Enabled)}
                        className={`w-14 h-8 rounded-full transition-colors ${
                          part2Enabled ? 'bg-green-500' : 'bg-surface-secondary'
                        }`}
                      >
                        <div
                          className={`w-6 h-6 bg-white rounded-full transition-transform mx-1 ${
                            part2Enabled ? 'translate-x-6' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {part2Enabled && (
                    <>
                      {/* Part 2: Text */}
                      <div>
                        <label className="block text-sm font-medium text-foreground-secondary mb-2">
                          Part 2: Text (Optional)
                        </label>
                        <textarea
                          value={part2Text}
                          onChange={(e) => setPart2Text(e.target.value)}
                          placeholder="Additional information..."
                          className="w-full h-20 px-4 py-3 bg-surface-secondary border border-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                        />
                      </div>

                      {/* Part 2: Image */}
                      <div>
                        <label className="block text-sm font-medium text-foreground-secondary mb-2">
                          Part 2: Image (Optional)
                        </label>
                        <input
                          type="file"
                          ref={fileInputRef}
                          accept="image/*"
                          onChange={handleImageSelect}
                          className="hidden"
                        />
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full py-4 bg-surface-secondary border-2 border-dashed border-border rounded-lg hover:border-primary transition-colors flex items-center justify-center gap-2 text-foreground-secondary hover:text-foreground"
                        >
                          {selectedImage ? (
                            <>
                              <Check size={20} className="text-green-400" />
                              {selectedImage.name}
                            </>
                          ) : (
                            <>
                              <Upload size={20} />
                              Select Image
                            </>
                          )}
                        </button>
                        {selectedImage && (
                          <button
                            onClick={() => setSelectedImage(null)}
                            className="mt-2 text-sm text-red-400 hover:text-red-300"
                          >
                            Remove selected image
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Group Selector */}
              <div className="bg-surface-secondary/50 rounded-lg overflow-hidden">
                <div
                  className="p-4 border-b border-border flex items-center justify-between cursor-pointer"
                  onClick={() => setGroupsExpanded(!groupsExpanded)}
                >
                  <div>
                    <h3 className="font-medium text-foreground flex items-center gap-2">
                      <Users size={18} />
                      Apply to Groups
                    </h3>
                    <p className="text-sm text-muted mt-1">
                      {selectedGroups.length} of {welcomeData?.groups?.length || 0} selected
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
                        onClick={(e) => { e.stopPropagation(); selectAllGroups() }}
                        className="flex-1 py-1.5 text-sm bg-surface-secondary text-foreground-secondary rounded hover:bg-surface-secondary transition-colors"
                      >
                        Select All
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deselectAllGroups() }}
                        className="flex-1 py-1.5 text-sm bg-surface-secondary text-foreground-secondary rounded hover:bg-surface-secondary transition-colors"
                      >
                        Deselect All
                      </button>
                    </div>

                    <div className="max-h-48 overflow-y-auto">
                      {welcomeData?.groups && welcomeData.groups.length > 0 ? (
                        <div className="divide-y divide-border">
                          {welcomeData.groups.map((group) => (
                            <button
                              key={group.id}
                              onClick={() => toggleGroup(group.id)}
                              className="w-full p-3 flex items-center gap-3 hover:bg-surface-secondary/80/50 transition-colors text-left"
                            >
                              {selectedGroups.includes(group.id) ? (
                                <CheckSquare size={20} className="text-primary flex-shrink-0" />
                              ) : (
                                <Square size={20} className="text-muted flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-foreground truncate">{group.group_name}</p>
                                <p className="text-xs text-muted">
                                  {group.welcome_enabled ? 'Currently enabled' : 'Currently disabled'}
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

            <div className="p-4 border-t border-border flex items-center justify-between">
              <p className="text-sm text-muted">
                {selectedGroups.length} groups selected
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowConfigModal(false); resetForm() }}
                  className="px-4 py-2 bg-surface-secondary text-foreground-secondary rounded-lg hover:bg-surface-secondary/80 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={selectedGroups.length === 0 || updateBulkMutation.isPending || uploadImageMutation.isPending}
                  className="px-4 py-2 bg-primary text-foreground rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  {(updateBulkMutation.isPending || uploadImageMutation.isPending) && (
                    <Loader2 size={16} className="animate-spin" />
                  )}
                  Save Settings
                </button>
              </div>
            </div>

            {(updateBulkMutation.error || uploadImageMutation.error) && (
              <div className="mx-4 mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 flex items-center gap-2">
                <AlertCircle size={18} />
                {(updateBulkMutation.error as Error)?.message || (uploadImageMutation.error as Error)?.message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
