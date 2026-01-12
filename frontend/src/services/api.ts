// Detect environment at runtime using current protocol
const API_BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:8000'
  : `${window.location.protocol}//backend-production-d7e2.up.railway.app`

class ApiClient {
  private token: string | null = null

  setToken(token: string | null) {
    this.token = token
    if (token) {
      localStorage.setItem('token', token)
    } else {
      localStorage.removeItem('token')
    }
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('token')
    }
    return this.token
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken()
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }))
      throw new Error(error.detail || 'Request failed')
    }

    return response.json()
  }

  // Auth
  async login(email: string, password: string) {
    return this.request<{ access_token: string; token_type: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  }

  async register(username: string, email: string, password: string) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    })
  }

  async getMe() {
    return this.request<{
      id: number
      username: string
      email: string
      is_admin: boolean
      is_active: boolean
    }>('/api/auth/me')
  }

  // WhatsApp
  async getWhatsAppStatus() {
    return this.request<{
      status: string
      is_authenticated: boolean
      phone_number: string | null
      has_qr: boolean
    }>('/api/whatsapp/status')
  }

  async initWhatsApp() {
    return this.request<{ success: boolean; status: string; message?: string }>(
      '/api/whatsapp/init',
      { method: 'POST' }
    )
  }

  async getQRCode() {
    return this.request<{ qr: string | null; status: string; has_qr: boolean }>(
      '/api/whatsapp/qr'
    )
  }

  async logoutWhatsApp() {
    return this.request('/api/whatsapp/logout', { method: 'POST' })
  }

  async getAvailableGroups() {
    return this.request<{
      success: boolean
      groups: Array<{ id: string; name: string; participant_count: number }>
    }>('/api/whatsapp/available-groups')
  }

  async getGroupMembers(whatsappGroupId: string) {
    return this.request<{
      success: boolean
      members: Array<{
        id: string
        name: string
        phone: string
        isAdmin: boolean
      }>
    }>(`/api/whatsapp/groups/${encodeURIComponent(whatsappGroupId)}/members`)
  }

  // Groups
  async getGroups() {
    return this.request<Array<{
      id: number
      whatsapp_group_id: string
      group_name: string
      member_count: number
      is_active: boolean
    }>>('/api/groups')
  }

  async addGroup(whatsapp_group_id: string, group_name: string, member_count: number = 0) {
    return this.request('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ whatsapp_group_id, group_name, member_count }),
    })
  }

  async removeGroup(groupId: number) {
    return this.request(`/api/groups/${groupId}`, { method: 'DELETE' })
  }

  // Messages
  async getMessages(params?: { group_id?: number; limit?: number; offset?: number }) {
    const searchParams = new URLSearchParams()
    if (params?.group_id) searchParams.append('group_id', params.group_id.toString())
    if (params?.limit) searchParams.append('limit', params.limit.toString())
    if (params?.offset) searchParams.append('offset', params.offset.toString())

    return this.request<{
      messages: Array<{
        id: string
        group_name: string
        sender_name: string
        sender_phone: string | null
        content: string
        timestamp: string
      }>
      total: number
      limit: number
      offset: number
    }>(`/api/messages?${searchParams}`)
  }

  async searchMessages(query: string, groupId?: number) {
    const searchParams = new URLSearchParams({ q: query })
    if (groupId) searchParams.append('group_id', groupId.toString())

    return this.request(`/api/messages/search?${searchParams}`)
  }

  // Events
  async getEvents(params?: {
    event_type?: string
    date_from?: string
    date_to?: string
    member_name?: string
    group_id?: number
    limit?: number
    offset?: number
  }) {
    const searchParams = new URLSearchParams()
    if (params?.event_type) searchParams.append('event_type', params.event_type)
    if (params?.date_from) searchParams.append('date_from', params.date_from)
    if (params?.date_to) searchParams.append('date_to', params.date_to)
    if (params?.member_name) searchParams.append('member_name', params.member_name)
    if (params?.group_id) searchParams.append('group_id', params.group_id.toString())
    if (params?.limit) searchParams.append('limit', params.limit.toString())
    if (params?.offset) searchParams.append('offset', params.offset.toString())

    return this.request<{
      events: Array<{
        id: number
        group_name: string
        member_name: string
        member_phone: string | null
        event_type: string
        event_date: string
        timestamp: string
      }>
      total: number
    }>(`/api/events?${searchParams}`)
  }

  async exportEventsCSV(params?: {
    event_type?: string
    date_from?: string
    date_to?: string
    member_name?: string
    group_id?: number
  }) {
    const searchParams = new URLSearchParams()
    if (params?.event_type) searchParams.append('event_type', params.event_type)
    if (params?.date_from) searchParams.append('date_from', params.date_from)
    if (params?.date_to) searchParams.append('date_to', params.date_to)
    if (params?.member_name) searchParams.append('member_name', params.member_name)
    if (params?.group_id) searchParams.append('group_id', params.group_id.toString())

    const token = this.getToken()
    const response = await fetch(`${API_BASE_URL}/api/events/export/csv?${searchParams}`, {
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    })

    if (!response.ok) {
      throw new Error('Failed to export CSV')
    }

    // Get filename from Content-Disposition header
    const contentDisposition = response.headers.get('Content-Disposition')
    let filename = 'events.csv'
    if (contentDisposition) {
      const match = contentDisposition.match(/filename=(.+)/)
      if (match) {
        filename = match[1]
      }
    }

    // Download the file
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }

  async getEventsSummary(params?: { date_from?: string; date_to?: string; group_id?: number }) {
    const searchParams = new URLSearchParams()
    if (params?.date_from) searchParams.append('date_from', params.date_from)
    if (params?.date_to) searchParams.append('date_to', params.date_to)
    if (params?.group_id) searchParams.append('group_id', params.group_id.toString())

    return this.request<{ total_joins: number; total_leaves: number; net_change: number }>(`/api/events/summary?${searchParams}`)
  }

  // Stats
  async getOverview(days?: number, groupId?: number) {
    const searchParams = new URLSearchParams()
    if (days) searchParams.append('days', days.toString())
    if (groupId) searchParams.append('group_id', groupId.toString())

    return this.request<{
      total_messages: number
      total_groups: number
      total_joins: number
      total_leaves: number
      net_member_change: number
      unique_senders: number
    }>(`/api/stats/overview?${searchParams}`)
  }

  async getDailyStats(days?: number, groupId?: number) {
    const searchParams = new URLSearchParams()
    if (days) searchParams.append('days', days.toString())
    if (groupId) searchParams.append('group_id', groupId.toString())

    return this.request<Array<{ date: string; count: number }>>(`/api/stats/daily?${searchParams}`)
  }

  async getTopSenders(limit?: number, groupId?: number) {
    const searchParams = new URLSearchParams()
    if (limit) searchParams.append('limit', limit.toString())
    if (groupId) searchParams.append('group_id', groupId.toString())

    return this.request<Array<{ sender_name: string; sender_phone: string | null; message_count: number }>>(
      `/api/stats/top-senders?${searchParams}`
    )
  }

  async getMemberChanges(days?: number, groupId?: number) {
    const searchParams = new URLSearchParams()
    if (days) searchParams.append('days', days.toString())
    if (groupId) searchParams.append('group_id', groupId.toString())

    return this.request<Array<{ date: string; joins: number; leaves: number }>>(
      `/api/stats/member-changes?${searchParams}`
    )
  }

  // Admin
  async getAdminUsers(limit?: number, offset?: number) {
    const searchParams = new URLSearchParams()
    if (limit) searchParams.append('limit', limit.toString())
    if (offset) searchParams.append('offset', offset.toString())

    return this.request<Array<{
      id: number
      username: string
      email: string
      is_admin: boolean
      is_active: boolean
      created_at: string
      whatsapp_status: string
      whatsapp_connected: boolean
      whatsapp_phone: string | null
      message_count: number
      group_count: number
      event_count: number
      certificate_count: number
    }>>(`/api/admin/users?${searchParams}`)
  }

  async getAdminUserMessages(userId: number, params?: { group_id?: number; limit?: number; offset?: number }) {
    const searchParams = new URLSearchParams()
    if (params?.group_id) searchParams.append('group_id', params.group_id.toString())
    if (params?.limit) searchParams.append('limit', params.limit.toString())
    if (params?.offset) searchParams.append('offset', params.offset.toString())

    return this.request<{
      messages: Array<{
        id: string
        group_name: string
        sender_name: string
        sender_phone: string | null
        content: string
        timestamp: string
      }>
      total: number
      limit: number
      offset: number
    }>(`/api/admin/users/${userId}/messages?${searchParams}`)
  }

  async getAdminUserEvents(userId: number, params?: {
    event_type?: string
    date_from?: string
    date_to?: string
    member_name?: string
    group_id?: number
    limit?: number
    offset?: number
  }) {
    const searchParams = new URLSearchParams()
    if (params?.event_type) searchParams.append('event_type', params.event_type)
    if (params?.date_from) searchParams.append('date_from', params.date_from)
    if (params?.date_to) searchParams.append('date_to', params.date_to)
    if (params?.member_name) searchParams.append('member_name', params.member_name)
    if (params?.group_id) searchParams.append('group_id', params.group_id.toString())
    if (params?.limit) searchParams.append('limit', params.limit.toString())
    if (params?.offset) searchParams.append('offset', params.offset.toString())

    return this.request<{
      events: Array<{
        id: number
        group_name: string
        member_name: string
        member_phone: string | null
        event_type: string
        event_date: string
        timestamp: string
      }>
      total: number
    }>(`/api/admin/users/${userId}/events?${searchParams}`)
  }

  async getAdminUserCertificates(userId: number, params?: { limit?: number; offset?: number }) {
    const searchParams = new URLSearchParams()
    if (params?.limit) searchParams.append('limit', params.limit.toString())
    if (params?.offset) searchParams.append('offset', params.offset.toString())

    return this.request<{
      certificates: Array<{
        id: number
        group_name: string
        member_name: string
        member_phone: string | null
        event_date: string
        timestamp: string
      }>
      total: number
    }>(`/api/admin/users/${userId}/certificates?${searchParams}`)
  }

  async getAdminUserGroups(userId: number) {
    return this.request<Array<{
      id: number
      whatsapp_group_id: string
      group_name: string
      member_count: number
      is_active: boolean
    }>>(`/api/admin/users/${userId}/groups`)
  }

  async getAdminUserCertificatesSummary(userId: number, params?: {
    date_from?: string
    date_to?: string
    group_id?: number
  }) {
    const searchParams = new URLSearchParams()
    if (params?.date_from) searchParams.append('date_from', params.date_from)
    if (params?.date_to) searchParams.append('date_to', params.date_to)
    if (params?.group_id) searchParams.append('group_id', params.group_id.toString())

    return this.request<{
      summary: Array<{
        member_name: string
        member_phone: string | null
        certificate_count: number
        groups: string | null
      }>
      total_certificates: number
      unique_members: number
      period_start: string | null
      period_end: string | null
    }>(`/api/admin/users/${userId}/certificates/summary?${searchParams}`)
  }

  async getAdminUserOverview(userId: number) {
    return this.request<{
      total_messages: number
      total_groups: number
      total_joins: number
      total_leaves: number
      net_member_change: number
      unique_senders: number
    }>(`/api/admin/users/${userId}/stats/overview`)
  }

  async toggleUserAdmin(userId: number) {
    return this.request(`/api/admin/users/${userId}/admin`, { method: 'PUT' })
  }

  async deleteUser(userId: number) {
    return this.request(`/api/admin/users/${userId}`, { method: 'DELETE' })
  }

  async getAdminOverview() {
    return this.request<{
      total_users: number
      active_users: number
      admin_users: number
      connected_whatsapp_sessions: number
      total_messages: number
      total_groups: number
    }>('/api/admin/stats/overview')
  }

  // Certificates
  async getCertificates(params?: {
    date_from?: string
    date_to?: string
    member_name?: string
    group_id?: number
    limit?: number
    offset?: number
  }) {
    const searchParams = new URLSearchParams()
    if (params?.date_from) searchParams.append('date_from', params.date_from)
    if (params?.date_to) searchParams.append('date_to', params.date_to)
    if (params?.member_name) searchParams.append('member_name', params.member_name)
    if (params?.group_id) searchParams.append('group_id', params.group_id.toString())
    if (params?.limit) searchParams.append('limit', params.limit.toString())
    if (params?.offset) searchParams.append('offset', params.offset.toString())

    return this.request<{
      certificates: Array<{
        id: number
        group_id: number
        group_name: string
        member_name: string
        member_phone: string | null
        event_date: string
        timestamp: string
      }>
      total: number
      limit: number
      offset: number
    }>(`/api/certificates?${searchParams}`)
  }

  async getCertificatesSummary(params?: {
    date_from?: string
    date_to?: string
    group_id?: number
  }) {
    const searchParams = new URLSearchParams()
    if (params?.date_from) searchParams.append('date_from', params.date_from)
    if (params?.date_to) searchParams.append('date_to', params.date_to)
    if (params?.group_id) searchParams.append('group_id', params.group_id.toString())

    return this.request<{
      summary: Array<{
        member_name: string
        member_phone: string | null
        certificate_count: number
        groups: string | null
      }>
      total_certificates: number
      unique_members: number
      period_start: string | null
      period_end: string | null
    }>(`/api/certificates/summary?${searchParams}`)
  }

  async exportCertificatesCSV(params?: {
    date_from?: string
    date_to?: string
    member_name?: string
    group_id?: number
  }) {
    const searchParams = new URLSearchParams()
    if (params?.date_from) searchParams.append('date_from', params.date_from)
    if (params?.date_to) searchParams.append('date_to', params.date_to)
    if (params?.member_name) searchParams.append('member_name', params.member_name)
    if (params?.group_id) searchParams.append('group_id', params.group_id.toString())

    const token = this.getToken()
    const response = await fetch(`${API_BASE_URL}/api/certificates/export/csv?${searchParams}`, {
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    })

    if (!response.ok) {
      throw new Error('Failed to export CSV')
    }

    // Get filename from Content-Disposition header
    const contentDisposition = response.headers.get('Content-Disposition')
    let filename = 'certificates.csv'
    if (contentDisposition) {
      const match = contentDisposition.match(/filename=(.+)/)
      if (match) {
        filename = match[1]
      }
    }

    // Download the file
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }

  // Groups - Send messages
  async sendMessageToGroup(
    groupId: number,
    content: string,
    mentionAll: boolean = false,
    mentionIds?: string[]
  ) {
    return this.request<{
      success: boolean
      messageId: string
      timestamp: number
    }>(`/api/groups/${groupId}/send`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        mention_all: mentionAll,
        mention_ids: mentionIds,
      }),
    })
  }

  async sendMediaToGroup(
    groupId: number,
    media: File,
    caption?: string,
    mentionAll: boolean = false,
    mentionIds?: string[]
  ) {
    const formData = new FormData()
    formData.append('media', media)
    if (caption) formData.append('caption', caption)
    formData.append('mention_all', String(mentionAll))
    if (mentionIds) formData.append('mention_ids', JSON.stringify(mentionIds))

    const token = this.getToken()
    const response = await fetch(`${API_BASE_URL}/api/groups/${groupId}/send-media`, {
      method: 'POST',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }))
      throw new Error(error.detail || 'Request failed')
    }

    return response.json()
  }

  // Broadcast
  async sendBroadcast(data: {
    content: string
    group_ids: number[]
    mention_type: 'none' | 'all' | 'selected'
    mention_ids?: string[]
    scheduled_at?: string
  }) {
    return this.request<{
      success: boolean
      message_id: number
      scheduled: boolean
      scheduled_at: string | null
      groups: string[]
    }>('/api/broadcast/send', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async sendBroadcastWithMedia(
    media: File,
    groupIds: number[],
    content?: string,
    mentionType: 'none' | 'all' | 'selected' = 'none',
    mentionIds?: string[],
    scheduledAt?: string
  ) {
    const formData = new FormData()
    formData.append('media', media)
    formData.append('group_ids', JSON.stringify(groupIds))
    if (content) formData.append('content', content)
    formData.append('mention_type', mentionType)
    if (mentionIds) formData.append('mention_ids', JSON.stringify(mentionIds))
    if (scheduledAt) formData.append('scheduled_at', scheduledAt)

    const token = this.getToken()
    const response = await fetch(`${API_BASE_URL}/api/broadcast/send-media`, {
      method: 'POST',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }))
      throw new Error(error.detail || 'Request failed')
    }

    return response.json()
  }

  async getScheduledMessages() {
    return this.request<Array<{
      id: number
      content: string
      group_names: string[]
      mention_type: string
      scheduled_at: string
      status: string
      created_at: string
    }>>('/api/broadcast/scheduled')
  }

  async getBroadcastHistory(limit?: number, offset?: number) {
    const searchParams = new URLSearchParams()
    if (limit) searchParams.append('limit', limit.toString())
    if (offset) searchParams.append('offset', offset.toString())

    return this.request<{
      broadcasts: Array<{
        id: number
        content: string
        group_names: string[]
        mention_type: string
        scheduled_at: string | null
        sent_at: string | null
        status: string
        groups_sent: number
        groups_failed: number
        error_message: string | null
        created_at: string
      }>
      total: number
    }>(`/api/broadcast/history?${searchParams}`)
  }

  async cancelScheduledMessage(messageId: number) {
    return this.request<{ success: boolean; message: string }>(
      `/api/broadcast/scheduled/${messageId}`,
      { method: 'DELETE' }
    )
  }

  async getBroadcastDetails(messageId: number) {
    return this.request<{
      id: number
      content: string
      group_names: string[]
      mention_type: string
      mention_ids: string[] | null
      scheduled_at: string | null
      sent_at: string | null
      status: string
      groups_sent: number
      groups_failed: number
      error_message: string | null
      created_at: string
    }>(`/api/broadcast/${messageId}`)
  }

  // Group Settings Schedules
  async createSettingsSchedule(data: {
    group_ids: number[]
    open_time: string
    close_time: string
    open_message?: string
    close_message?: string
    mention_type?: 'none' | 'all' | 'selected'
    mention_ids?: string[]
  }) {
    return this.request<{
      success: boolean
      schedule_id: number
      open_time: string
      close_time: string
      next_open: string
      next_close: string
      groups: string[]
    }>('/api/group-settings/schedules', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getSettingsSchedules() {
    return this.request<{
      schedules: Array<{
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
      }>
    }>('/api/group-settings/schedules')
  }

  async deleteSettingsSchedule(scheduleId: number) {
    return this.request<{ success: boolean; message: string }>(
      `/api/group-settings/schedules/${scheduleId}`,
      { method: 'DELETE' }
    )
  }

  async toggleSettingsSchedule(scheduleId: number) {
    return this.request<{
      success: boolean
      is_active: boolean
      message: string
      next_open?: string
      next_close?: string
    }>(`/api/group-settings/schedules/${scheduleId}/toggle`, { method: 'POST' })
  }

  async setGroupSettingsNow(data: {
    group_ids: number[]
    admin_only: boolean
    message?: string
    mention_type?: 'none' | 'all' | 'selected'
    mention_ids?: string[]
  }) {
    return this.request<{
      success: boolean
      action: string
      groups: string[]
      message: string
    }>('/api/group-settings/immediate', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getGroupSettingsHistory(limit?: number) {
    const searchParams = new URLSearchParams()
    if (limit) searchParams.append('limit', limit.toString())

    return this.request<{
      history: Array<{
        id: number
        task_type: string
        action: string
        group_names: string[]
        scheduled_at: string | null
        sent_at: string | null
        status: string
        groups_success: number
        groups_failed: number
        error_message: string | null
        is_recurring: boolean
        message_sent: boolean
      }>
    }>(`/api/group-settings/history?${searchParams}`)
  }

  // Welcome Messages
  async getWelcomeSettings() {
    return this.request<{
      groups: Array<{
        id: number
        group_name: string
        whatsapp_group_id: string
        welcome_enabled: boolean
        welcome_threshold: number
        welcome_join_count: number
        welcome_text: string | null
        welcome_part2_enabled: boolean
        welcome_part2_text: string | null
        welcome_part2_image: string | null
      }>
    }>('/api/welcome')
  }

  async getWelcomeSettingsForGroup(groupId: number) {
    return this.request<{
      id: number
      group_name: string
      whatsapp_group_id: string
      welcome_enabled: boolean
      welcome_threshold: number
      welcome_join_count: number
      welcome_pending_joiners: string[]
      welcome_text: string | null
      welcome_part2_enabled: boolean
      welcome_part2_text: string | null
      welcome_part2_image: string | null
    }>(`/api/welcome/${groupId}`)
  }

  async updateWelcomeSettingsBulk(data: {
    group_ids: number[]
    enabled: boolean
    threshold?: number
    text?: string
    part2_enabled?: boolean
    part2_text?: string
  }) {
    return this.request<{
      success: boolean
      updated_count: number
      groups: string[]
    }>('/api/welcome/bulk', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async updateWelcomeSettingsForGroup(
    groupId: number,
    data: {
      enabled?: boolean
      threshold?: number
      text?: string
      part2_enabled?: boolean
      part2_text?: string
    }
  ) {
    const searchParams = new URLSearchParams()
    if (data.enabled !== undefined) searchParams.append('enabled', String(data.enabled))
    if (data.threshold !== undefined) searchParams.append('threshold', data.threshold.toString())
    if (data.text !== undefined) searchParams.append('text', data.text)
    if (data.part2_enabled !== undefined) searchParams.append('part2_enabled', String(data.part2_enabled))
    if (data.part2_text !== undefined) searchParams.append('part2_text', data.part2_text)

    return this.request<{
      success: boolean
      group_name: string
      welcome_enabled: boolean
    }>(`/api/welcome/${groupId}?${searchParams}`, {
      method: 'PUT',
    })
  }

  async uploadWelcomeImage(groupIds: number[], image: File) {
    const formData = new FormData()
    formData.append('group_ids', groupIds.join(','))
    formData.append('image', image)

    const token = this.getToken()
    const response = await fetch(`${API_BASE_URL}/api/welcome/upload-image`, {
      method: 'POST',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }))
      throw new Error(error.detail || 'Request failed')
    }

    return response.json()
  }

  async deleteWelcomeImage(groupId: number) {
    return this.request<{ success: boolean }>(`/api/welcome/${groupId}/image`, {
      method: 'DELETE',
    })
  }

  async resetWelcomeCounter(groupId: number) {
    return this.request<{ success: boolean; message: string }>(
      `/api/welcome/${groupId}/reset-counter`,
      { method: 'POST' }
    )
  }

  async disableAllWelcomeMessages() {
    return this.request<{ success: boolean; disabled_count: number }>(
      '/api/welcome/disable-all',
      { method: 'POST' }
    )
  }

  // AI Agents
  async getAgents() {
    return this.request<{
      agents: Array<{
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
      }>
    }>('/api/agents')
  }

  async getAgent(agentId: number) {
    return this.request<{
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
    }>(`/api/agents/${agentId}`)
  }

  async createAgent(data: {
    name: string
    api_url: string
    api_key: string
    input_token_limit?: number
    output_token_limit?: number
    system_prompt?: string
  }) {
    return this.request<{
      success: boolean
      agent_id: number
      name: string
    }>('/api/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateAgent(
    agentId: number,
    data: {
      name?: string
      api_url?: string
      api_key?: string
      input_token_limit?: number
      output_token_limit?: number
      system_prompt?: string
    }
  ) {
    return this.request<{
      success: boolean
      agent_id: number
      name: string
    }>(`/api/agents/${agentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteAgent(agentId: number) {
    return this.request<{ success: boolean; message: string }>(
      `/api/agents/${agentId}`,
      { method: 'DELETE' }
    )
  }

  async activateAgent(agentId: number) {
    return this.request<{
      success: boolean
      agent_id: number
      name: string
      is_active: boolean
    }>(`/api/agents/${agentId}/activate`, { method: 'POST' })
  }

  async deactivateAgent(agentId: number) {
    return this.request<{
      success: boolean
      agent_id: number
      name: string
      is_active: boolean
    }>(`/api/agents/${agentId}/deactivate`, { method: 'POST' })
  }

  async updateAgentGroups(agentId: number, enabledGroupIds: number[]) {
    return this.request<{
      success: boolean
      agent_id: number
      enabled_group_ids: number[]
      groups_count: number
    }>(`/api/agents/${agentId}/groups`, {
      method: 'PUT',
      body: JSON.stringify({ enabled_group_ids: enabledGroupIds }),
    })
  }

  async getAgentGroups(agentId: number) {
    return this.request<{
      groups: Array<{
        id: number
        group_name: string
        member_count: number
        enabled: boolean
      }>
    }>(`/api/agents/${agentId}/groups`)
  }
}

export const api = new ApiClient()
