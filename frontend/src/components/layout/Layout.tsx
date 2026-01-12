import { Outlet, Link, useLocation } from 'react-router-dom'
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

export default function Layout() {
  const { user, logout } = useAuth()
  const { isConnected } = useWebSocket()
  const location = useLocation()

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/connect', label: 'WhatsApp', icon: LinkIcon },
    { path: '/messages', label: 'Messages', icon: MessageSquare },
    { path: '/events', label: 'Events', icon: Users },
    { path: '/certificates', label: 'Certificates', icon: Award },
    { path: '/analytics', label: 'Analytics', icon: BarChart3 },
    { path: '/broadcast', label: 'Broadcast', icon: Send },
    { path: '/group-settings', label: 'Group Settings', icon: Settings },
    { path: '/welcome', label: 'Welcome Messages', icon: UserPlus },
    { path: '/agents', label: 'AI Agent', icon: Bot },
  ]

  if (user?.is_admin) {
    navItems.push({ path: '/admin', label: 'Admin', icon: Shield })
  }

  return (
    <div className="min-h-screen bg-slate-900 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-800 border-r border-slate-700">
        <div className="p-4 border-b border-slate-700">
          <h1 className="text-xl font-bold text-white">WhatsApp Analytics</h1>
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
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* User info */}
        <div className="absolute bottom-0 left-0 w-64 p-4 border-t border-slate-700 bg-slate-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                {user?.username?.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm text-white font-medium">{user?.username}</p>
                <p className="text-xs text-slate-400">{user?.email}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isConnected ? (
                <Wifi size={16} className="text-green-500" />
              ) : (
                <WifiOff size={16} className="text-red-500" />
              )}
              <span className="text-xs text-slate-400">
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>

            <button
              onClick={logout}
              className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
            >
              <LogOut size={16} />
              <span className="text-sm">Logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
