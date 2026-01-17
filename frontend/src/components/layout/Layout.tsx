import { Outlet, Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { useWebSocket } from '../../contexts/WebSocketContext'
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Wifi,
  WifiOff,
  Link as LinkIcon,
  Shield,
  Award,
  Send,
  UserPlus,
  Bot,
} from 'lucide-react'
import HeaderBar from './HeaderBar'

export default function Layout() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const { isConnected } = useWebSocket()
  const location = useLocation()

  const navItems = [
    { path: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
    { path: '/connect', labelKey: 'nav.whatsappConnect', icon: LinkIcon },
    { path: '/messages', labelKey: 'nav.messages', icon: MessageSquare },
    { path: '/events', labelKey: 'nav.events', icon: Users },
    { path: '/certificates', labelKey: 'nav.certificates', icon: Award },
    { path: '/analytics', labelKey: 'nav.analytics', icon: BarChart3 },
    { path: '/broadcast', labelKey: 'nav.broadcast', icon: Send },
    { path: '/group-settings', labelKey: 'nav.groupSettings', icon: Settings },
    { path: '/welcome', labelKey: 'nav.welcomeMessages', icon: UserPlus },
    { path: '/agents', labelKey: 'nav.agent', icon: Bot },
  ]

  if (user?.is_admin) {
    navItems.push({ path: '/admin', labelKey: 'nav.admin', icon: Shield })
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 bg-surface border-r border-border">
        <div className="p-4 border-b border-border">
          <h1 className="text-xl font-bold text-foreground">WhatsApp Analytics</h1>
        </div>

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
                <span>{t(item.labelKey)}</span>
              </Link>
            )
          })}
        </nav>

        {/* User info */}
        <div className="absolute bottom-0 left-0 w-64 p-4 border-t border-border bg-surface">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white text-sm font-medium">
                {user?.username?.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm text-foreground font-medium">{user?.username}</p>
                <p className="text-xs text-muted">{user?.email}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isConnected ? (
                <Wifi size={16} className="text-success" />
              ) : (
                <WifiOff size={16} className="text-error" />
              )}
              <span className="text-xs text-muted">
                {isConnected ? t('status.connected') : t('status.disconnected')}
              </span>
            </div>

            <button
              onClick={logout}
              className="flex items-center gap-2 text-muted hover:text-foreground transition-colors"
            >
              <LogOut size={16} />
              <span className="text-sm">{t('nav.logout')}</span>
            </button>
          </div>
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
