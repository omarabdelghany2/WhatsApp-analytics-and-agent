import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '../services/api'
import { useWebSocket } from '../contexts/WebSocketContext'
import { useAdmin } from '../contexts/AdminContext'
import { Search, MessageSquare, Users, ChevronRight, X, Shield, Loader2, Send, Paperclip, Image } from 'lucide-react'
import { format } from 'date-fns'
import { useLocation } from 'react-router-dom'

interface Message {
  id: string
  group_name: string
  sender_name: string
  sender_phone?: string | null
  content: string
  timestamp: string
}

interface Group {
  id: number
  whatsapp_group_id: string
  group_name: string
  member_count: number
  is_active: boolean
}

export default function MessagesPage() {
  const { viewingUser } = useAdmin()
  const location = useLocation()
  const isAdminView = location.pathname.startsWith('/admin/user')

  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(0)
  const [realtimeMessages, setRealtimeMessages] = useState<Message[]>([])
  const [showMembersModal, setShowMembersModal] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const limit = 50
  const { subscribe, isConnected } = useWebSocket()

  // Message composer state
  const [messageContent, setMessageContent] = useState('')
  const [selectedMedia, setSelectedMedia] = useState<File | null>(null)
  const [mediaPreview, setMediaPreview] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async () => {
      if (!selectedGroup) throw new Error('No group selected')

      if (selectedMedia) {
        return api.sendMediaToGroup(selectedGroup.id, selectedMedia, messageContent || undefined)
      } else {
        if (!messageContent.trim()) throw new Error('Message content is required')
        return api.sendMessageToGroup(selectedGroup.id, messageContent)
      }
    },
    onSuccess: () => {
      setMessageContent('')
      setSelectedMedia(null)
      setMediaPreview(null)
      setSendError(null)
      refetch()
    },
    onError: (error: Error) => {
      setSendError(error.message)
    },
  })

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedMedia(file)
      // Create preview for images
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = (e) => setMediaPreview(e.target?.result as string)
        reader.readAsDataURL(file)
      } else {
        setMediaPreview(null)
      }
    }
  }

  // Handle send
  const handleSend = () => {
    if ((!messageContent.trim() && !selectedMedia) || isSending) return
    setIsSending(true)
    setSendError(null)
    sendMessageMutation.mutate(undefined, {
      onSettled: () => setIsSending(false),
    })
  }

  // Handle key press
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
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

  const { data: groups } = useQuery({
    queryKey: isAdminView && viewingUser ? ['admin-user-groups', viewingUser.id] : ['groups'],
    queryFn: () =>
      isAdminView && viewingUser
        ? api.getAdminUserGroups(viewingUser.id)
        : api.getGroups(),
  })

  const { data: messages, refetch } = useQuery({
    queryKey: isAdminView && viewingUser
      ? ['admin-user-messages', viewingUser.id, selectedGroup?.id, page]
      : ['messages', selectedGroup?.id, page],
    queryFn: () =>
      isAdminView && viewingUser
        ? api.getAdminUserMessages(viewingUser.id, {
            group_id: selectedGroup?.id,
            limit,
            offset: page * limit,
          })
        : api.getMessages({
            group_id: selectedGroup?.id,
            limit,
            offset: page * limit,
          }),
    enabled: !!selectedGroup,
  })

  const { data: searchResults } = useQuery({
    queryKey: ['search-messages', searchQuery, selectedGroup?.id],
    queryFn: () => api.searchMessages(searchQuery, selectedGroup?.id),
    enabled: searchQuery.length >= 2 && !!selectedGroup && !isAdminView,
  })

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['group-members', selectedGroup?.whatsapp_group_id],
    queryFn: () => api.getGroupMembers(selectedGroup!.whatsapp_group_id),
    enabled: showMembersModal && !!selectedGroup?.whatsapp_group_id && !isAdminView,
  })

  // Subscribe to new messages (only for regular users, not admin view)
  useEffect(() => {
    if (isAdminView) return

    const unsubscribe = subscribe('new_message', (data) => {
      console.log('[WS] New message received:', data)
      const newMsg = data.message as Message

      // Only add if it's for the selected group or show all
      if (!selectedGroup || newMsg.group_name === selectedGroup.group_name) {
        setRealtimeMessages(prev => [newMsg, ...prev])
      }

      // Also refetch to update counts
      refetch()
    })
    return unsubscribe
  }, [subscribe, refetch, selectedGroup, isAdminView])

  // Clear realtime messages when changing groups
  useEffect(() => {
    setRealtimeMessages([])
    setPage(0)
  }, [selectedGroup])

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [realtimeMessages])

  const displayMessages = searchQuery.length >= 2 && !isAdminView
    ? (searchResults as typeof messages)?.messages || []
    : [...realtimeMessages, ...(messages?.messages || [])]

  // Remove duplicates (realtime messages might also be in the fetched list)
  const uniqueMessages = displayMessages.filter((msg, index, self) =>
    index === self.findIndex(m => m.id === msg.id)
  )

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Groups Sidebar */}
      <div className="w-80 bg-surface border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Users size={20} />
            Groups
          </h2>
          <p className="text-sm text-muted mt-1">
            {groups?.length || 0} monitored groups
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {groups && groups.length > 0 ? (
            <div className="divide-y divide-border">
              {groups.map(group => (
                <button
                  key={group.id}
                  onClick={() => setSelectedGroup(group)}
                  className={`w-full p-4 text-left hover:bg-surface-secondary transition-colors flex items-center justify-between ${
                    selectedGroup?.id === group.id ? 'bg-surface-secondary border-l-4 border-primary' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium truncate ${
                      selectedGroup?.id === group.id ? 'text-foreground' : 'text-foreground-secondary'
                    }`}>
                      {group.group_name}
                    </p>
                    <p className="text-sm text-muted">
                      {group.member_count} members
                    </p>
                  </div>
                  <ChevronRight
                    size={18}
                    className={`text-muted ${selectedGroup?.id === group.id ? 'text-primary' : ''}`}
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-muted">
              <Users size={48} className="mx-auto mb-4 opacity-50" />
              <p>No groups monitored</p>
              {!isAdminView && (
                <p className="text-sm mt-2">Add groups from the WhatsApp page</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messages Panel */}
      <div className="flex-1 flex flex-col bg-background">
        {selectedGroup ? (
          <>
            {/* Header */}
            <div className="p-4 bg-surface border-b border-border flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold text-foreground">{selectedGroup.group_name}</h1>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-sm text-muted">
                    {messages?.total || 0} messages
                  </span>
                  {!isAdminView && (
                    <button
                      onClick={() => setShowMembersModal(true)}
                      className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary-hover transition-colors"
                    >
                      <Users size={14} />
                      {selectedGroup.member_count} members
                    </button>
                  )}
                  {!isAdminView && (
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                      isConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
                      {isConnected ? 'Live' : 'Offline'}
                    </span>
                  )}
                </div>
              </div>

              {/* Search - only for regular users */}
              {!isAdminView && (
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search messages..."
                    className="w-full pl-10 pr-4 py-2 bg-surface-secondary border border-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}
            </div>

            {/* Messages List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {uniqueMessages.length > 0 ? (
                <>
                  {/* Pagination at top */}
                  {!searchQuery && messages && messages.total > limit && (
                    <div className="flex items-center justify-center gap-4 py-2">
                      <button
                        onClick={() => setPage(p => p + 1)}
                        disabled={(page + 1) * limit >= messages.total}
                        className="px-4 py-2 bg-surface-secondary text-foreground rounded-lg disabled:opacity-50 hover:bg-surface-secondary/80 text-sm"
                      >
                        Load Older
                      </button>
                      <span className="text-muted text-sm">
                        Page {page + 1} of {Math.ceil(messages.total / limit)}
                      </span>
                    </div>
                  )}

                  {/* Messages */}
                  {[...uniqueMessages].reverse().map((message) => (
                    <div
                      key={message.id}
                      className={`p-4 rounded-lg ${
                        realtimeMessages.some(m => m.id === message.id)
                          ? 'bg-primary/10 border border-primary/30'
                          : 'bg-surface'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{message.sender_name}</span>
                          {message.sender_phone && (
                            <span className="text-sm text-muted">({message.sender_phone})</span>
                          )}
                        </div>
                        <span className="text-xs text-muted">
                          {format(new Date(message.timestamp), 'MMM d, HH:mm')}
                        </span>
                      </div>
                      <p className="text-foreground-secondary whitespace-pre-wrap">{message.content}</p>
                    </div>
                  ))}

                  {/* New messages indicator */}
                  {!isAdminView && realtimeMessages.length > 0 && (
                    <div className="text-center text-primary text-sm py-2">
                      {realtimeMessages.length} new message{realtimeMessages.length > 1 ? 's' : ''}
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center text-muted">
                    <MessageSquare size={48} className="mx-auto mb-4 opacity-50" />
                    <p>No messages yet</p>
                    {searchQuery && (
                      <p className="text-sm mt-2">Try a different search query</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Message Composer - only for regular users */}
            {!isAdminView && (
              <div className="p-4 bg-surface border-t border-border">
                {/* Media Preview */}
                {selectedMedia && (
                  <div className="mb-3 p-3 bg-surface-secondary rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {mediaPreview ? (
                        <img src={mediaPreview} alt="Preview" className="w-12 h-12 object-cover rounded" />
                      ) : (
                        <div className="w-12 h-12 bg-surface rounded flex items-center justify-center">
                          <Paperclip size={20} className="text-muted" />
                        </div>
                      )}
                      <div>
                        <p className="text-foreground text-sm truncate max-w-xs">{selectedMedia.name}</p>
                        <p className="text-xs text-muted">
                          {(selectedMedia.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={clearMedia}
                      className="p-1 hover:bg-surface rounded transition-colors"
                    >
                      <X size={18} className="text-muted" />
                    </button>
                  </div>
                )}

                {/* Error Message */}
                {sendError && (
                  <div className="mb-3 p-2 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    {sendError}
                  </div>
                )}

                {/* Input Area */}
                <div className="flex items-end gap-3">
                  {/* File Input (hidden) */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileSelect}
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"
                    className="hidden"
                  />

                  {/* Attach Button */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2.5 bg-surface-secondary hover:bg-surface-secondary/80 rounded-lg transition-colors flex-shrink-0"
                    title="Attach file"
                  >
                    <Paperclip size={20} className="text-foreground-secondary" />
                  </button>

                  {/* Message Input */}
                  <div className="flex-1">
                    <textarea
                      value={messageContent}
                      onChange={(e) => setMessageContent(e.target.value)}
                      onKeyDown={handleKeyPress}
                      placeholder="Type a message..."
                      rows={1}
                      className="w-full px-4 py-2.5 bg-surface-secondary border border-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                      style={{ minHeight: '44px', maxHeight: '120px' }}
                    />
                  </div>

                  {/* Send Button */}
                  <button
                    onClick={handleSend}
                    disabled={isSending || (!messageContent.trim() && !selectedMedia)}
                    className="p-2.5 bg-primary hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex-shrink-0"
                    title="Send message"
                  >
                    {isSending ? (
                      <Loader2 size={20} className="text-white animate-spin" />
                    ) : (
                      <Send size={20} className="text-white" />
                    )}
                  </button>
                </div>

                <p className="text-xs text-muted mt-2">
                  Press Enter to send, Shift+Enter for new line
                </p>
              </div>
            )}
          </>
        ) : (
          /* No group selected */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted">
              <MessageSquare size={64} className="mx-auto mb-4 opacity-50" />
              <h2 className="text-xl font-semibold text-foreground-secondary mb-2">Select a Group</h2>
              <p>Choose a group from the sidebar to view messages</p>
            </div>
          </div>
        )}
      </div>

      {/* Members Modal */}
      {showMembersModal && selectedGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md max-h-[80vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Group Members</h2>
                <p className="text-sm text-muted">{selectedGroup.group_name}</p>
              </div>
              <button
                onClick={() => setShowMembersModal(false)}
                className="p-2 hover:bg-surface-secondary rounded-lg transition-colors"
              >
                <X size={20} className="text-muted" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto">
              {membersLoading ? (
                <div className="p-8 text-center">
                  <Loader2 className="animate-spin mx-auto mb-4 text-muted" size={32} />
                  <p className="text-muted">Loading members...</p>
                </div>
              ) : membersData?.members && membersData.members.length > 0 ? (
                <div className="divide-y divide-border">
                  {/* Sort: admins first, then alphabetically */}
                  {[...membersData.members]
                    .sort((a, b) => {
                      if (a.isAdmin && !b.isAdmin) return -1
                      if (!a.isAdmin && b.isAdmin) return 1
                      return a.name.localeCompare(b.name)
                    })
                    .map((member) => (
                      <div key={member.id} className="p-3 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-surface-secondary flex items-center justify-center text-foreground font-medium">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-foreground font-medium truncate">{member.name}</p>
                            {member.isAdmin && (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                                <Shield size={10} />
                                Admin
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted">{member.phone}</p>
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted">
                  <Users size={48} className="mx-auto mb-4 opacity-50" />
                  <p>Could not load members</p>
                  <p className="text-sm mt-2">Make sure WhatsApp is connected</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-border">
              <p className="text-sm text-muted text-center">
                {membersData?.members?.length || 0} members
                {membersData?.members && ` (${membersData.members.filter(m => m.isAdmin).length} admins)`}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
