import { useQuery } from '@tanstack/react-query'
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
} from 'lucide-react'

export default function AdminPage() {
  const { user, logout } = useAuth()
  const { setViewingUser } = useAdmin()
  const navigate = useNavigate()

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.getAdminUsers(),
  })

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
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-purple-500/20 p-2 rounded-lg">
              <Shield className="text-purple-500" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Admin Panel</h1>
              <p className="text-sm text-slate-400">Select an account to view</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                {user?.username?.charAt(0).toUpperCase()}
              </div>
              <span className="text-white">{user?.username}</span>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
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
          <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <div className="flex items-center gap-3">
              <div className="bg-blue-500/20 p-2 rounded-lg">
                <Users className="text-blue-500" size={20} />
              </div>
              <div>
                <p className="text-slate-400 text-sm">Total Accounts</p>
                <p className="text-2xl font-bold text-white">{regularUsers.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <div className="flex items-center gap-3">
              <div className="bg-green-500/20 p-2 rounded-lg">
                <Wifi className="text-green-500" size={20} />
              </div>
              <div>
                <p className="text-slate-400 text-sm">Connected</p>
                <p className="text-2xl font-bold text-white">
                  {regularUsers.filter(u => u.whatsapp_connected).length}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <div className="flex items-center gap-3">
              <div className="bg-amber-500/20 p-2 rounded-lg">
                <MessageSquare className="text-amber-500" size={20} />
              </div>
              <div>
                <p className="text-slate-400 text-sm">Total Messages</p>
                <p className="text-2xl font-bold text-white">
                  {regularUsers.reduce((sum, u) => sum + u.message_count, 0).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Accounts List */}
        <div className="bg-slate-800 rounded-lg border border-slate-700">
          <div className="p-4 border-b border-slate-700">
            <h2 className="text-lg font-semibold text-white">WhatsApp Accounts</h2>
            <p className="text-sm text-slate-400">Click on an account to view its data</p>
          </div>

          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-slate-400">Loading accounts...</p>
            </div>
          ) : regularUsers.length > 0 ? (
            <div className="divide-y divide-slate-700">
              {regularUsers.map(account => (
                <button
                  key={account.id}
                  onClick={() => handleSelectUser(account)}
                  className="w-full p-4 flex items-center gap-4 hover:bg-slate-700/50 transition-colors text-left"
                >
                  {/* Avatar */}
                  <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white font-medium text-lg">
                    {account.username.charAt(0).toUpperCase()}
                  </div>

                  {/* User Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium">{account.username}</span>
                      {account.whatsapp_connected ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 text-green-500 rounded text-xs">
                          <Wifi size={12} />
                          Connected
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-slate-600 text-slate-400 rounded text-xs">
                          <WifiOff size={12} />
                          Not Connected
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-400">{account.email}</p>
                    {account.whatsapp_phone && (
                      <p className="text-sm text-slate-500">{account.whatsapp_phone}</p>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <p className="text-white font-medium">{account.group_count}</p>
                      <p className="text-slate-400 text-xs">Groups</p>
                    </div>
                    <div className="text-center">
                      <p className="text-white font-medium">{account.message_count.toLocaleString()}</p>
                      <p className="text-slate-400 text-xs">Messages</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Award size={14} className="text-amber-500" />
                        <span className="text-white font-medium">{account.certificate_count}</span>
                      </div>
                      <p className="text-slate-400 text-xs">Certs</p>
                    </div>
                  </div>

                  {/* Arrow */}
                  <ChevronRight size={20} className="text-slate-500" />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center">
              <Users size={48} className="mx-auto mb-4 text-slate-600" />
              <p className="text-slate-400">No accounts found</p>
              <p className="text-sm text-slate-500 mt-1">
                Regular user accounts will appear here
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
