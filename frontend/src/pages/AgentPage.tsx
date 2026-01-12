import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import {
  Bot,
  Plus,
  Edit,
  Trash2,
  Power,
  PowerOff,
  X,
  Loader2,
  AlertCircle,
  Settings,
  Users,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
  Key,
  Link as LinkIcon,
  MessageSquare,
  Zap,
} from 'lucide-react'

interface Agent {
  id: number
  name: string
  api_url: string
  api_key: string
  input_token_limit: number
  output_token_limit: number
  system_prompt: string | null
  is_active: boolean
  enabled_group_ids: number[]
  created_at: string | null
  updated_at: string | null
}

interface AgentGroup {
  id: number
  group_name: string
  member_count: number
  enabled: boolean
}

export default function AgentPage() {
  const queryClient = useQueryClient()

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showGroupsModal, setShowGroupsModal] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [apiUrl, setApiUrl] = useState('https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent')
  const [apiKey, setApiKey] = useState('')
  const [inputTokenLimit, setInputTokenLimit] = useState(4096)
  const [outputTokenLimit, setOutputTokenLimit] = useState(1024)
  const [systemPrompt, setSystemPrompt] = useState('')

  // Groups state
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([])
  const [groupsExpanded, setGroupsExpanded] = useState(true)

  // Fetch agents
  const { data: agentsData, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.getAgents(),
  })

  // Fetch groups for modal
  const { data: groupsData } = useQuery({
    queryKey: ['agent-groups', selectedAgent?.id],
    queryFn: () => selectedAgent ? api.getAgentGroups(selectedAgent.id) : null,
    enabled: !!selectedAgent && showGroupsModal,
  })

  // Create agent mutation
  const createMutation = useMutation({
    mutationFn: (data: {
      name: string
      api_url: string
      api_key: string
      input_token_limit: number
      output_token_limit: number
      system_prompt?: string
    }) => api.createAgent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      setShowCreateModal(false)
      resetForm()
    },
  })

  // Update agent mutation
  const updateMutation = useMutation({
    mutationFn: ({ agentId, data }: { agentId: number; data: any }) =>
      api.updateAgent(agentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      setShowEditModal(false)
      setSelectedAgent(null)
      resetForm()
    },
  })

  // Delete agent mutation
  const deleteMutation = useMutation({
    mutationFn: (agentId: number) => api.deleteAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })

  // Activate/Deactivate mutations
  const activateMutation = useMutation({
    mutationFn: (agentId: number) => api.activateAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: (agentId: number) => api.deactivateAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })

  // Update groups mutation
  const updateGroupsMutation = useMutation({
    mutationFn: ({ agentId, groupIds }: { agentId: number; groupIds: number[] }) =>
      api.updateAgentGroups(agentId, groupIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      queryClient.invalidateQueries({ queryKey: ['agent-groups'] })
      setShowGroupsModal(false)
      setSelectedAgent(null)
    },
  })

  // Reset form
  const resetForm = () => {
    setName('')
    setApiUrl('https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent')
    setApiKey('')
    setInputTokenLimit(4096)
    setOutputTokenLimit(1024)
    setSystemPrompt('')
  }

  // Open edit modal
  const openEditModal = async (agent: Agent) => {
    const fullAgent = await api.getAgent(agent.id)
    setSelectedAgent(fullAgent)
    setName(fullAgent.name)
    setApiUrl(fullAgent.api_url)
    setApiKey(fullAgent.api_key)
    setInputTokenLimit(fullAgent.input_token_limit)
    setOutputTokenLimit(fullAgent.output_token_limit)
    setSystemPrompt(fullAgent.system_prompt || '')
    setShowEditModal(true)
  }

  // Open groups modal
  const openGroupsModal = (agent: Agent) => {
    setSelectedAgent(agent)
    setSelectedGroupIds(agent.enabled_group_ids || [])
    setShowGroupsModal(true)
  }

  // Toggle group selection
  const toggleGroup = (groupId: number) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId]
    )
  }

  // Handle create
  const handleCreate = () => {
    if (!name || !apiUrl || !apiKey) return

    createMutation.mutate({
      name,
      api_url: apiUrl,
      api_key: apiKey,
      input_token_limit: inputTokenLimit,
      output_token_limit: outputTokenLimit,
      system_prompt: systemPrompt || undefined,
    })
  }

  // Handle update
  const handleUpdate = () => {
    if (!selectedAgent || !name || !apiUrl || !apiKey) return

    updateMutation.mutate({
      agentId: selectedAgent.id,
      data: {
        name,
        api_url: apiUrl,
        api_key: apiKey,
        input_token_limit: inputTokenLimit,
        output_token_limit: outputTokenLimit,
        system_prompt: systemPrompt || undefined,
      },
    })
  }

  // Handle save groups
  const handleSaveGroups = () => {
    if (!selectedAgent) return
    updateGroupsMutation.mutate({
      agentId: selectedAgent.id,
      groupIds: selectedGroupIds,
    })
  }

  // Get active agent count
  const activeAgent = agentsData?.agents?.find((a) => a.is_active)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Agents</h1>
          <p className="text-slate-400 mt-1">
            Configure AI agents that respond when you're mentioned in groups
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
        >
          <Plus size={16} />
          Add Agent
        </button>
      </div>

      {/* Active Agent Status */}
      {activeAgent && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Zap size={20} className="text-green-400" />
            </div>
            <div>
              <h3 className="font-medium text-green-400">Active Agent: {activeAgent.name}</h3>
              <p className="text-sm text-slate-400">
                Responding to mentions in {activeAgent.enabled_group_ids?.length || 0} groups
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Agents List */}
      {isLoading ? (
        <div className="bg-slate-800 rounded-lg p-12 text-center">
          <Loader2 size={48} className="mx-auto mb-4 text-blue-400 animate-spin" />
          <p className="text-slate-400">Loading agents...</p>
        </div>
      ) : agentsData?.agents && agentsData.agents.length > 0 ? (
        <div className="space-y-4">
          {agentsData.agents.map((agent) => (
            <div
              key={agent.id}
              className={`bg-slate-800 rounded-lg p-4 ${
                agent.is_active ? 'ring-2 ring-green-500/50' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${agent.is_active ? 'bg-green-500/20' : 'bg-slate-700'}`}>
                    <Bot size={24} className={agent.is_active ? 'text-green-400' : 'text-slate-400'} />
                  </div>
                  <div>
                    <h3 className="text-white font-medium text-lg">{agent.name}</h3>
                    <p className="text-sm text-slate-400">
                      {agent.is_active ? 'Active' : 'Inactive'} - {agent.enabled_group_ids?.length || 0} groups enabled
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openGroupsModal(agent)}
                    className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors flex items-center gap-1 text-sm"
                  >
                    <Users size={14} />
                    Groups
                  </button>
                  <button
                    onClick={() => openEditModal(agent)}
                    className="p-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors"
                  >
                    <Edit size={16} />
                  </button>
                  {agent.is_active ? (
                    <button
                      onClick={() => deactivateMutation.mutate(agent.id)}
                      disabled={deactivateMutation.isPending}
                      className="px-3 py-1.5 bg-orange-500/20 text-orange-400 rounded-lg hover:bg-orange-500/30 transition-colors text-sm"
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      onClick={() => activateMutation.mutate(agent.id)}
                      disabled={activateMutation.isPending}
                      className="px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors text-sm"
                    >
                      Activate
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this agent?')) {
                        deleteMutation.mutate(agent.id)
                      }
                    }}
                    disabled={deleteMutation.isPending}
                    className="p-1.5 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Agent Details */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-2 bg-slate-700/50 rounded-lg">
                  <div className="flex items-center gap-1 text-slate-400 text-xs mb-1">
                    <LinkIcon size={12} />
                    API URL
                  </div>
                  <p className="text-white text-sm truncate">{agent.api_url.split('/').pop()}</p>
                </div>
                <div className="p-2 bg-slate-700/50 rounded-lg">
                  <div className="flex items-center gap-1 text-slate-400 text-xs mb-1">
                    <Key size={12} />
                    API Key
                  </div>
                  <p className="text-white text-sm font-mono">{agent.api_key}</p>
                </div>
                <div className="p-2 bg-slate-700/50 rounded-lg">
                  <p className="text-slate-400 text-xs mb-1">Input Limit</p>
                  <p className="text-white text-sm">{agent.input_token_limit} tokens</p>
                </div>
                <div className="p-2 bg-slate-700/50 rounded-lg">
                  <p className="text-slate-400 text-xs mb-1">Output Limit</p>
                  <p className="text-white text-sm">{agent.output_token_limit} tokens</p>
                </div>
              </div>

              {agent.system_prompt && (
                <div className="mt-3 p-3 bg-slate-700/30 rounded-lg">
                  <p className="text-xs text-slate-400 mb-1">System Prompt</p>
                  <p className="text-slate-300 text-sm line-clamp-2">{agent.system_prompt}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-slate-800 rounded-lg p-12 text-center">
          <Bot size={48} className="mx-auto mb-4 text-slate-600" />
          <h3 className="text-lg font-medium text-slate-300 mb-2">No Agents Created</h3>
          <p className="text-slate-500 mb-4">
            Create an AI agent to automatically respond when you're mentioned in groups.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Create Your First Agent
          </button>
        </div>
      )}

      {/* Create/Edit Modal */}
      {(showCreateModal || showEditModal) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                {showEditModal ? 'Edit Agent' : 'Create Agent'}
              </h2>
              <button
                onClick={() => {
                  setShowCreateModal(false)
                  setShowEditModal(false)
                  setSelectedAgent(null)
                  resetForm()
                }}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X size={20} className="text-slate-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Agent Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My AI Assistant"
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* API URL */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  API URL *
                </label>
                <input
                  type="text"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent"
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>

              {/* API Key */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  API Key *
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Your API key"
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              {/* Token Limits */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Input Token Limit
                  </label>
                  <input
                    type="number"
                    value={inputTokenLimit}
                    onChange={(e) => setInputTokenLimit(parseInt(e.target.value) || 4096)}
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Output Token Limit
                  </label>
                  <input
                    type="number"
                    value={outputTokenLimit}
                    onChange={(e) => setOutputTokenLimit(parseInt(e.target.value) || 1024)}
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* System Prompt */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  System Prompt (Optional)
                </label>
                <p className="text-xs text-slate-400 mb-2">
                  Define the agent's personality and behavior
                </p>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="You are a helpful and friendly assistant. Be concise and professional."
                  className="w-full h-32 px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-700 flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowCreateModal(false)
                  setShowEditModal(false)
                  setSelectedAgent(null)
                  resetForm()
                }}
                className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={showEditModal ? handleUpdate : handleCreate}
                disabled={!name || !apiUrl || !apiKey || createMutation.isPending || updateMutation.isPending}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 size={16} className="animate-spin" />
                )}
                {showEditModal ? 'Save Changes' : 'Create Agent'}
              </button>
            </div>

            {(createMutation.error || updateMutation.error) && (
              <div className="mx-4 mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 flex items-center gap-2">
                <AlertCircle size={18} />
                {(createMutation.error as Error)?.message || (updateMutation.error as Error)?.message}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Groups Modal */}
      {showGroupsModal && selectedAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Enable Groups</h2>
                <p className="text-sm text-slate-400">Agent: {selectedAgent.name}</p>
              </div>
              <button
                onClick={() => {
                  setShowGroupsModal(false)
                  setSelectedAgent(null)
                }}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X size={20} className="text-slate-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {groupsData?.groups && groupsData.groups.length > 0 ? (
                <div className="divide-y divide-slate-700">
                  {groupsData.groups.map((group) => (
                    <button
                      key={group.id}
                      onClick={() => toggleGroup(group.id)}
                      className="w-full p-4 flex items-center gap-3 hover:bg-slate-700/50 transition-colors text-left"
                    >
                      {selectedGroupIds.includes(group.id) ? (
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

            <div className="p-4 border-t border-slate-700 flex items-center justify-between">
              <p className="text-sm text-slate-400">
                {selectedGroupIds.length} groups selected
              </p>
              <button
                onClick={handleSaveGroups}
                disabled={updateGroupsMutation.isPending}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {updateGroupsMutation.isPending && (
                  <Loader2 size={16} className="animate-spin" />
                )}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
