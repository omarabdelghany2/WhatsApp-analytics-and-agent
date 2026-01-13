import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
} from 'lucide-react'

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
  const [extraMentions, setExtraMentions] = useState('')
  const [part2Enabled, setPart2Enabled] = useState(false)
  const [part2Text, setPart2Text] = useState('')
  const [selectedImage, setSelectedImage] = useState<File | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch welcome settings
  const { data: welcomeData, isLoading, refetch } = useQuery({
    queryKey: ['welcome-settings'],
    queryFn: () => api.getWelcomeSettings(),
  })

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
    setExtraMentions('')
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
    setExtraMentions(group.welcome_extra_mentions?.join(', ') || '')
    setPart2Enabled(group.welcome_part2_enabled || false)
    setPart2Text(group.welcome_part2_text || '')
    setSelectedImage(null) // Can't pre-load existing image file
    setShowConfigModal(true)
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

    // Parse extra mentions from comma-separated string
    const mentionsList = extraMentions
      .split(',')
      .map(phone => phone.trim().replace(/[^0-9+]/g, ''))
      .filter(phone => phone.length > 0)

    await updateBulkMutation.mutateAsync({
      group_ids: selectedGroups,
      enabled,
      threshold,
      text: welcomeText || undefined,
      extra_mentions: mentionsList.length > 0 ? mentionsList : undefined,
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
          <h1 className="text-2xl font-bold text-white">Welcome Messages</h1>
          <p className="text-slate-400 mt-1">
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
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
          >
            <Settings size={16} />
            Configure
          </button>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1">
            <Users size={16} />
            <span className="text-sm">Total Groups</span>
          </div>
          <p className="text-2xl font-bold text-white">{totalGroups}</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-green-400 mb-1">
            <Power size={16} />
            <span className="text-sm">Enabled</span>
          </div>
          <p className="text-2xl font-bold text-white">{enabledCount}</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1">
            <PowerOff size={16} />
            <span className="text-sm">Disabled</span>
          </div>
          <p className="text-2xl font-bold text-white">{totalGroups - enabledCount}</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-blue-400 mb-1">
            <MessageSquare size={16} />
            <span className="text-sm">Pending Joins</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {welcomeData?.groups?.reduce((sum, g) => sum + g.welcome_join_count, 0) || 0}
          </p>
        </div>
      </div>

      {/* Groups List */}
      {isLoading ? (
        <div className="bg-slate-800 rounded-lg p-12 text-center">
          <Loader2 size={48} className="mx-auto mb-4 text-blue-400 animate-spin" />
          <p className="text-slate-400">Loading welcome settings...</p>
        </div>
      ) : welcomeData?.groups && welcomeData.groups.length > 0 ? (
        <div className="space-y-4">
          {welcomeData.groups.map((group) => (
            <div
              key={group.id}
              className="bg-slate-800 rounded-lg p-4"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${group.welcome_enabled ? 'bg-green-500/20' : 'bg-slate-700'}`}>
                    {group.welcome_enabled ? (
                      <Power size={20} className="text-green-400" />
                    ) : (
                      <PowerOff size={20} className="text-slate-400" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-white font-medium">{group.group_name}</h3>
                    <p className="text-sm text-slate-400">
                      {group.welcome_enabled ? 'Welcome message enabled' : 'Disabled'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => editGroup(group)}
                    className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors flex items-center gap-1 text-sm"
                  >
                    <Settings size={14} />
                    Edit
                  </button>
                  {group.welcome_enabled && group.welcome_join_count > 0 && (
                    <button
                      onClick={() => resetCounterMutation.mutate(group.id)}
                      disabled={resetCounterMutation.isPending}
                      className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors flex items-center gap-1 text-sm"
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
                    <div className="p-2 bg-slate-700/50 rounded-lg">
                      <p className="text-xs text-slate-400">Threshold</p>
                      <p className="text-white font-medium">{group.welcome_threshold} joins</p>
                    </div>
                    <div className="p-2 bg-slate-700/50 rounded-lg">
                      <p className="text-xs text-slate-400">Current Count</p>
                      <p className="text-white font-medium">
                        {group.welcome_join_count}/{group.welcome_threshold}
                      </p>
                    </div>
                    <div className="p-2 bg-slate-700/50 rounded-lg">
                      <p className="text-xs text-slate-400">Extra Mentions</p>
                      <p className="text-white font-medium">
                        {group.welcome_extra_mentions?.length || 0}
                      </p>
                    </div>
                    <div className="p-2 bg-slate-700/50 rounded-lg">
                      <p className="text-xs text-slate-400">Part 2</p>
                      <p className="text-white font-medium">
                        {group.welcome_part2_enabled ? 'Enabled' : 'Disabled'}
                      </p>
                    </div>
                    <div className="p-2 bg-slate-700/50 rounded-lg">
                      <p className="text-xs text-slate-400">Image</p>
                      <p className="text-white font-medium flex items-center gap-1">
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
                    <div className="p-3 bg-slate-700/30 rounded-lg">
                      <p className="text-xs text-slate-400 mb-1">Welcome Text (Part 1)</p>
                      <p className="text-slate-300 text-sm">{group.welcome_text}</p>
                    </div>
                  )}

                  {/* Part 2 Text Preview */}
                  {group.welcome_part2_enabled && group.welcome_part2_text && (
                    <div className="mt-2 p-3 bg-slate-700/30 rounded-lg">
                      <p className="text-xs text-slate-400 mb-1">Part 2 Text</p>
                      <p className="text-slate-300 text-sm">{group.welcome_part2_text}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-slate-800 rounded-lg p-12 text-center">
          <MessageSquare size={48} className="mx-auto mb-4 text-slate-600" />
          <h3 className="text-lg font-medium text-slate-300 mb-2">
            No Groups Found
          </h3>
          <p className="text-slate-500">
            Add groups to your monitored list first.
          </p>
        </div>
      )}

      {/* Configuration Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Configure Welcome Message</h2>
              <button
                onClick={() => { setShowConfigModal(false); resetForm() }}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X size={20} className="text-slate-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Enable/Disable Toggle */}
              <div className="bg-slate-700/50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-white">Enable Welcome Messages</h3>
                    <p className="text-sm text-slate-400">
                      Automatically send welcome messages when members join
                    </p>
                  </div>
                  <button
                    onClick={() => setEnabled(!enabled)}
                    className={`w-14 h-8 rounded-full transition-colors ${
                      enabled ? 'bg-green-500' : 'bg-slate-600'
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
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Join Threshold
                    </label>
                    <p className="text-xs text-slate-400 mb-2">
                      Number of consecutive joins before sending welcome message
                    </p>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={threshold}
                      onChange={(e) => setThreshold(parseInt(e.target.value) || 1)}
                      className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Part 1: Welcome Text */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Part 1: Welcome Text
                    </label>
                    <p className="text-xs text-slate-400 mb-2">
                      This text will be sent along with mentions of new joiners
                    </p>
                    <textarea
                      value={welcomeText}
                      onChange={(e) => setWelcomeText(e.target.value)}
                      placeholder="Welcome to the group! Please read the pinned message."
                      className="w-full h-24 px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>

                  {/* Extra Mentions */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Extra Mentions (Optional)
                    </label>
                    <p className="text-xs text-slate-400 mb-2">
                      Phone numbers to mention at the end of the message (comma-separated, e.g., +201234567890, +201098765432)
                    </p>
                    <input
                      type="text"
                      value={extraMentions}
                      onChange={(e) => setExtraMentions(e.target.value)}
                      placeholder="+201234567890, +201098765432"
                      className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Part 2 Toggle */}
                  <div className="bg-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-white">Enable Part 2</h3>
                        <p className="text-sm text-slate-400">
                          Send a second message with text and/or image
                        </p>
                      </div>
                      <button
                        onClick={() => setPart2Enabled(!part2Enabled)}
                        className={`w-14 h-8 rounded-full transition-colors ${
                          part2Enabled ? 'bg-green-500' : 'bg-slate-600'
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
                        <label className="block text-sm font-medium text-slate-300 mb-2">
                          Part 2: Text (Optional)
                        </label>
                        <textarea
                          value={part2Text}
                          onChange={(e) => setPart2Text(e.target.value)}
                          placeholder="Additional information..."
                          className="w-full h-20 px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        />
                      </div>

                      {/* Part 2: Image */}
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">
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
                          className="w-full py-4 bg-slate-700 border-2 border-dashed border-slate-600 rounded-lg hover:border-blue-500 transition-colors flex items-center justify-center gap-2 text-slate-300 hover:text-white"
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
              <div className="bg-slate-700/50 rounded-lg overflow-hidden">
                <div
                  className="p-4 border-b border-slate-600 flex items-center justify-between cursor-pointer"
                  onClick={() => setGroupsExpanded(!groupsExpanded)}
                >
                  <div>
                    <h3 className="font-medium text-white flex items-center gap-2">
                      <Users size={18} />
                      Apply to Groups
                    </h3>
                    <p className="text-sm text-slate-400 mt-1">
                      {selectedGroups.length} of {welcomeData?.groups?.length || 0} selected
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
                    <div className="p-3 border-b border-slate-600 flex gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); selectAllGroups() }}
                        className="flex-1 py-1.5 text-sm bg-slate-600 text-slate-300 rounded hover:bg-slate-500 transition-colors"
                      >
                        Select All
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deselectAllGroups() }}
                        className="flex-1 py-1.5 text-sm bg-slate-600 text-slate-300 rounded hover:bg-slate-500 transition-colors"
                      >
                        Deselect All
                      </button>
                    </div>

                    <div className="max-h-48 overflow-y-auto">
                      {welcomeData?.groups && welcomeData.groups.length > 0 ? (
                        <div className="divide-y divide-slate-600">
                          {welcomeData.groups.map((group) => (
                            <button
                              key={group.id}
                              onClick={() => toggleGroup(group.id)}
                              className="w-full p-3 flex items-center gap-3 hover:bg-slate-600/50 transition-colors text-left"
                            >
                              {selectedGroups.includes(group.id) ? (
                                <CheckSquare size={20} className="text-blue-400 flex-shrink-0" />
                              ) : (
                                <Square size={20} className="text-slate-500 flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-white truncate">{group.group_name}</p>
                                <p className="text-xs text-slate-400">
                                  {group.welcome_enabled ? 'Currently enabled' : 'Currently disabled'}
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

            <div className="p-4 border-t border-slate-700 flex items-center justify-between">
              <p className="text-sm text-slate-400">
                {selectedGroups.length} groups selected
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowConfigModal(false); resetForm() }}
                  className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={selectedGroups.length === 0 || updateBulkMutation.isPending || uploadImageMutation.isPending}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
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
