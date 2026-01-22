import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useAdmin } from '../contexts/AdminContext'
import {
  Shield,
  Users,
  Wifi,
  WifiOff,
  LogOut,
  MessageSquare,
  Award,
  ChevronRight,
  Trash2,
} from 'lucide-react'

export default function AdminPage() {
  const { user, logout } = useAuth()
  const { setViewingUser } = useAdmin()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.getAdminUsers(),
  })

  const deleteMutation = useMutation({
    mutationFn: (userId: number) => api.deleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    }
  })

  const handleDeleteUser = (e: React.MouseEvent, account: typeof regularUsers[0]) => {
    e.stopPropagation()
    if (window.confirm(`Delete "${account.username}"?\n\nThis permanently deletes all their data including messages, events, and scheduled broadcasts.`)) {
      deleteMutation.mutate(account.id)
    }
  }

  // Filter out admin users - only show regular accounts
  const regularUsers = users?.filter(u => !u.is_admin) || []

  const handleSelectUser = (selectedUser: typeof regularUsers[0]) => {
    setViewingUser({
      id: selectedUser.id,
      username: selectedUser.username,
      email: selectedUser.email,
      whatsapp_connected: selectedUser.whatsapp_connected,
      whatsapp_phone: selectedUser.whatsapp_phone,
    })
    navigate('/admin/user')
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-surface border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-purple-500/20 p-2 rounded-lg">
              <Shield className="text-purple-500" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Admin Panel</h1>
              <p className="text-sm text-muted">Select an account to view</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                {user?.username?.charAt(0).toUpperCase()}
              </div>
              <span className="text-foreground">{user?.username}</span>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-2 px-3 py-2 text-muted hover:text-foreground hover:bg-surface-secondary rounded-lg transition-colors"
            >
              <LogOut size={18} />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-surface rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary/20 p-2 rounded-lg">
                <Users className="text-primary" size={20} />
              </div>
              <div>
                <p className="text-muted text-sm">Total Accounts</p>
                <p className="text-2xl font-bold text-foreground">{regularUsers.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-surface rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="bg-green-500/20 p-2 rounded-lg">
                <Wifi className="text-green-500" size={20} />
              </div>
              <div>
                <p className="text-muted text-sm">Connected</p>
                <p className="text-2xl font-bold text-foreground">
                  {regularUsers.filter(u => u.whatsapp_connected).length}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-surface rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="bg-amber-500/20 p-2 rounded-lg">
                <MessageSquare className="text-amber-500" size={20} />
              </div>
              <div>
                <p className="text-muted text-sm">Total Messages</p>
                <p className="text-2xl font-bold text-foreground">
                  {regularUsers.reduce((sum, u) => sum + u.message_count, 0).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Accounts List */}
        <div className="bg-surface rounded-lg border border-border">
          <div className="p-4 border-b border-border">
            <h2 className="text-lg font-semibold text-foreground">WhatsApp Accounts</h2>
            <p className="text-sm text-muted">Click on an account to view its data</p>
          </div>

          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-muted">Loading accounts...</p>
            </div>
          ) : regularUsers.length > 0 ? (
            <div className="divide-y divide-border">
              {regularUsers.map(account => (
                <button
                  key={account.id}
                  onClick={() => handleSelectUser(account)}
                  className="w-full p-4 flex items-center gap-4 hover:bg-surface-secondary/50 transition-colors text-left"
                >
                  {/* Avatar */}
                  <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center text-white font-medium text-lg">
                    {account.username.charAt(0).toUpperCase()}
                  </div>

                  {/* User Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground font-medium">{account.username}</span>
                      {account.whatsapp_connected ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 text-green-500 rounded text-xs">
                          <Wifi size={12} />
                          Connected
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-surface-secondary text-muted rounded text-xs">
                          <WifiOff size={12} />
                          Not Connected
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted">{account.email}</p>
                    {account.whatsapp_phone && (
                      <p className="text-sm text-muted">{account.whatsapp_phone}</p>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <p className="text-foreground font-medium">{account.group_count}</p>
                      <p className="text-muted text-xs">Groups</p>
                    </div>
                    <div className="text-center">
                      <p className="text-foreground font-medium">{account.message_count.toLocaleString()}</p>
                      <p className="text-muted text-xs">Messages</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Award size={14} className="text-amber-500" />
                        <span className="text-foreground font-medium">{account.certificate_count}</span>
                      </div>
                      <p className="text-muted text-xs">Certs</p>
                    </div>
                  </div>

                  {/* Delete Button */}
                  <button
                    onClick={(e) => handleDeleteUser(e, account)}
                    disabled={deleteMutation.isPending}
                    className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Delete account"
                  >
                    <Trash2 size={18} />
                  </button>

                  {/* Arrow */}
                  <ChevronRight size={20} className="text-muted" />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center">
              <Users size={48} className="mx-auto mb-4 text-muted" />
              <p className="text-muted">No accounts found</p>
              <p className="text-sm text-muted mt-1">
                Regular user accounts will appear here
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
