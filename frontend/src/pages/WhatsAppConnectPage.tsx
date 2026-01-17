import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { useWebSocket } from '../contexts/WebSocketContext'
import { Loader2, CheckCircle, XCircle, RefreshCw, Plus, Trash2 } from 'lucide-react'

export default function WhatsAppConnectPage() {
  const queryClient = useQueryClient()
  const { subscribe } = useWebSocket()
  const [qrCode, setQrCode] = useState<string | null>(null)

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => api.getWhatsAppStatus(),
    refetchInterval: false, // Don't auto-refresh, use WebSocket instead
  })

  const { data: groups, refetch: refetchGroups } = useQuery({
    queryKey: ['groups'],
    queryFn: () => api.getGroups(),
  })

  const { data: availableGroups, refetch: refetchAvailable } = useQuery({
    queryKey: ['available-groups'],
    queryFn: () => api.getAvailableGroups(),
    enabled: status?.is_authenticated === true,
  })

  const initMutation = useMutation({
    mutationFn: () => api.initWhatsApp(),
    onSuccess: () => {
      refetchStatus()
    },
  })

  const logoutMutation = useMutation({
    mutationFn: () => api.logoutWhatsApp(),
    onSuccess: () => {
      setQrCode(null)
      refetchStatus()
    },
  })

  const addGroupMutation = useMutation({
    mutationFn: ({ id, name, memberCount }: { id: string; name: string; memberCount: number }) =>
      api.addGroup(id, name, memberCount),
    onSuccess: () => {
      refetchGroups()
      queryClient.invalidateQueries({ queryKey: ['overview'] })
    },
  })

  const removeGroupMutation = useMutation({
    mutationFn: (groupId: number) => api.removeGroup(groupId),
    onSuccess: () => {
      refetchGroups()
      queryClient.invalidateQueries({ queryKey: ['overview'] })
    },
  })

  // Subscribe to WebSocket events
  useEffect(() => {
    const unsubscribeQr = subscribe('qr', (data) => {
      setQrCode(data.qr as string)
    })

    const unsubscribeAuth = subscribe('authenticated', () => {
      setQrCode(null)
      refetchStatus()
    })

    const unsubscribeReady = subscribe('ready', () => {
      refetchStatus()
      refetchAvailable()
    })

    return () => {
      unsubscribeQr()
      unsubscribeAuth()
      unsubscribeReady()
    }
  }, [subscribe, refetchStatus, refetchAvailable])

  // Fetch QR code manually - no auto-fetch to reduce CPU load
  const fetchQRCode = () => {
    api.getQRCode().then(data => {
      if (data.qr) {
        setQrCode(data.qr)
      }
    })
  }

  const getStatusColor = () => {
    switch (status?.status) {
      case 'ready':
      case 'authenticated':
        return 'text-green-500'
      case 'initializing':
      case 'qr_ready':
        return 'text-amber-500'
      case 'disconnected':
      case 'failed':
        return 'text-red-500'
      default:
        return 'text-muted'
    }
  }

  const getStatusText = () => {
    switch (status?.status) {
      case 'ready':
        return 'Connected'
      case 'authenticated':
        return 'Authenticated'
      case 'initializing':
        return 'Initializing...'
      case 'qr_ready':
        return 'Scan QR Code'
      case 'disconnected':
        return 'Disconnected'
      case 'failed':
        return 'Failed'
      default:
        return 'Not Connected'
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground mb-8">WhatsApp Connection</h1>

      {/* Status Card */}
      <div className="bg-surface rounded-lg border border-border p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full ${status?.is_authenticated ? 'bg-green-500' : 'bg-muted'}`} />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Connection Status</h2>
              <p className={`text-sm ${getStatusColor()}`}>{getStatusText()}</p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => refetchStatus()}
              className="flex items-center gap-2 px-3 py-2 bg-surface-secondary text-foreground rounded-lg hover:bg-surface-secondary/80"
              title="Refresh Status"
            >
              <RefreshCw size={16} />
            </button>
            {!status?.is_authenticated && (
              <button
                onClick={() => initMutation.mutate()}
                disabled={initMutation.isPending || status?.status === 'initializing'}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50"
              >
                {initMutation.isPending ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <RefreshCw size={16} />
                )}
                {status?.status === 'not_initialized' ? 'Connect' : 'Reconnect'}
              </button>
            )}

            {status?.is_authenticated && (
              <button
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {logoutMutation.isPending ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <XCircle size={16} />
                )}
                Disconnect
              </button>
            )}
          </div>
        </div>

        {status?.phone_number && (
          <p className="text-sm text-muted">
            Phone: {status.phone_number}
          </p>
        )}
      </div>

      {/* QR Code */}
      {(status?.status === 'qr_ready' || status?.status === 'initializing') && (
        <div className="bg-surface rounded-lg border border-border p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Scan QR Code</h2>
            <button
              onClick={fetchQRCode}
              className="flex items-center gap-2 px-3 py-1.5 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover"
            >
              <RefreshCw size={14} />
              {qrCode ? 'Refresh QR' : 'Load QR Code'}
            </button>
          </div>
          <p className="text-muted text-sm mb-4">
            Open WhatsApp on your phone, go to Settings &gt; Linked Devices &gt; Link a Device
          </p>
          {qrCode ? (
            <div className="flex justify-center">
              <div className="bg-white p-4 rounded-lg">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrCode)}`}
                  alt="WhatsApp QR Code"
                  className="w-64 h-64"
                />
              </div>
            </div>
          ) : (
            <div className="flex justify-center">
              <div className="bg-surface-secondary p-8 rounded-lg text-center">
                <p className="text-muted">Click "Load QR Code" to display the QR code</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Available Groups to Add */}
      {status?.is_authenticated && availableGroups?.groups && (
        <div className="bg-surface rounded-lg border border-border mb-8">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Available Groups</h2>
            <button
              onClick={() => refetchAvailable()}
              className="text-sm text-primary hover:text-primary-hover flex items-center gap-1"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>

          <div className="divide-y divide-border max-h-96 overflow-auto">
            {availableGroups.groups.map(group => {
              const isMonitored = groups?.some(g => g.whatsapp_group_id === group.id)
              return (
                <div key={group.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-foreground font-medium">{group.name}</p>
                    <p className="text-sm text-muted">
                      {group.participant_count} participants
                    </p>
                  </div>
                  {isMonitored ? (
                    <span className="flex items-center gap-1 text-green-500 text-sm">
                      <CheckCircle size={16} />
                      Monitoring
                    </span>
                  ) : (
                    <button
                      onClick={() => addGroupMutation.mutate({ id: group.id, name: group.name, memberCount: group.participant_count })}
                      disabled={addGroupMutation.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50"
                    >
                      <Plus size={14} />
                      Add
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Monitored Groups */}
      <div className="bg-surface rounded-lg border border-border">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Monitored Groups</h2>
        </div>

        {groups && groups.length > 0 ? (
          <div className="divide-y divide-border">
            {groups.map(group => (
              <div key={group.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-foreground font-medium">{group.group_name}</p>
                  <p className="text-sm text-muted">
                    {group.member_count} members
                  </p>
                </div>
                <button
                  onClick={() => removeGroupMutation.mutate(group.id)}
                  disabled={removeGroupMutation.isPending}
                  className="flex items-center gap-1 px-3 py-1.5 bg-red-600/20 text-red-500 rounded-lg text-sm hover:bg-red-600/30 disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-muted">
            <p>No groups being monitored</p>
            <p className="text-sm mt-2">
              Add groups from the available list above
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
