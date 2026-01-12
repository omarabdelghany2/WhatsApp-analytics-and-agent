import { createContext, useContext, useState, ReactNode } from 'react'

interface ViewingUser {
  id: number
  username: string
  email: string
  whatsapp_connected: boolean
  whatsapp_phone: string | null
}

interface AdminContextType {
  viewingUser: ViewingUser | null
  setViewingUser: (user: ViewingUser | null) => void
  isViewingUser: boolean
  clearViewingUser: () => void
}

const AdminContext = createContext<AdminContextType | undefined>(undefined)

export function AdminProvider({ children }: { children: ReactNode }) {
  const [viewingUser, setViewingUser] = useState<ViewingUser | null>(null)

  const clearViewingUser = () => {
    setViewingUser(null)
  }

  return (
    <AdminContext.Provider
      value={{
        viewingUser,
        setViewingUser,
        isViewingUser: !!viewingUser,
        clearViewingUser,
      }}
    >
      {children}
    </AdminContext.Provider>
  )
}

export function useAdmin() {
  const context = useContext(AdminContext)
  if (context === undefined) {
    throw new Error('useAdmin must be used within an AdminProvider')
  }
  return context
}
