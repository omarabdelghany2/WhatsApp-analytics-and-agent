import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useAdmin } from '../../contexts/AdminContext'
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  BarChart3,
  LogOut,
  Wifi,
  WifiOff,
  Award,
  ArrowLeft,
} from 'lucide-react'
import HeaderBar from './HeaderBar'

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const { viewingUser, clearViewingUser } = useAdmin()
  const location = useLocation()
  const navigate = useNavigate()

  const navItems = [
    { path: '/admin/user', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/admin/user/messages', label: 'Messages', icon: MessageSquare },
    { path: '/admin/user/events', label: 'Events', icon: Users },
    { path: '/admin/user/certificates', label: 'Certificates', icon: Award },
    { path: '/admin/user/analytics', label: 'Analytics', icon: BarChart3 },
  ]

  const handleBackToAccounts = () => {
    clearViewingUser()
    navigate('/admin')
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 bg-surface border-r border-border">
        <div className="p-4 border-b border-border">
          <h1 className="text-xl font-bold text-foreground">WhatsApp Analytics</h1>
          <p className="text-xs text-muted mt-1">Admin Mode</p>
        </div>

        {/* Back to Accounts Button */}
        <div className="p-4 border-b border-border">
          <button
            onClick={handleBackToAccounts}
            className="flex items-center gap-2 w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
          >
            <ArrowLeft size={18} />
            <span>Back to Accounts</span>
          </button>
        </div>

        {/* Viewing User Info */}
        {viewingUser && (
          <div className="p-4 border-b border-border bg-surface-secondary/30">
            <p className="text-xs text-muted mb-2">Viewing Account:</p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-medium">
                {viewingUser.username.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-foreground font-medium">{viewingUser.username}</p>
                <p className="text-xs text-muted">{viewingUser.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              {viewingUser.whatsapp_connected ? (
                <>
                  <Wifi size={14} className="text-success" />
                  <span className="text-xs text-success">
                    {viewingUser.whatsapp_phone || 'Connected'}
                  </span>
                </>
              ) : (
                <>
                  <WifiOff size={14} className="text-muted" />
                  <span className="text-xs text-muted">Not Connected</span>
                </>
              )}
            </div>
          </div>
        )}

        <nav className="p-4 space-y-2">
          {navItems.map(item => {
            const Icon = item.icon
            const isActive = location.pathname === item.path

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-foreground-secondary hover:bg-surface-secondary hover:text-foreground'
                }`}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Admin info */}
        <div className="absolute bottom-0 left-0 w-64 p-4 border-t border-border bg-surface">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                {user?.username?.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm text-foreground font-medium">{user?.username}</p>
                <p className="text-xs text-purple-400">Admin</p>
              </div>
            </div>
          </div>

          <button
            onClick={logout}
            className="flex items-center gap-2 text-muted hover:text-foreground transition-colors w-full"
          >
            <LogOut size={16} />
            <span className="text-sm">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto flex flex-col">
        <HeaderBar />
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
