import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { useAdmin } from './contexts/AdminContext'
import Layout from './components/layout/Layout'
import AdminLayout from './components/layout/AdminLayout'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import WhatsAppConnectPage from './pages/WhatsAppConnectPage'
import MessagesPage from './pages/MessagesPage'
import EventsPage from './pages/EventsPage'
import CertificatesPage from './pages/CertificatesPage'
import AnalyticsPage from './pages/AnalyticsPage'
import AdminPage from './pages/AdminPage'
import BroadcastPage from './pages/BroadcastPage'
import GroupSettingsPage from './pages/GroupSettingsPage'
import WelcomeMessagePage from './pages/WelcomeMessagePage'
import AgentPage from './pages/AgentPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // If user is admin and trying to access regular pages, redirect to admin
  if (user?.is_admin) {
    return <Navigate to="/admin" replace />
  }

  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isAuthenticated } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (!user?.is_admin) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

function AdminViewingUserRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isAuthenticated } = useAuth()
  const { isViewingUser } = useAdmin()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (!user?.is_admin) {
    return <Navigate to="/" replace />
  }

  if (!isViewingUser) {
    return <Navigate to="/admin" replace />
  }

  return <>{children}</>
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Admin account selector */}
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminPage />
          </AdminRoute>
        }
      />

      {/* Admin viewing a user's data */}
      <Route
        path="/admin/user"
        element={
          <AdminViewingUserRoute>
            <AdminLayout />
          </AdminViewingUserRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="connect" element={<WhatsAppConnectPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="certificates" element={<CertificatesPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
      </Route>

      {/* Regular user routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="connect" element={<WhatsAppConnectPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="certificates" element={<CertificatesPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="broadcast" element={<BroadcastPage />} />
        <Route path="group-settings" element={<GroupSettingsPage />} />
        <Route path="welcome" element={<WelcomeMessagePage />} />
        <Route path="agents" element={<AgentPage />} />
      </Route>
    </Routes>
  )
}

export default App
