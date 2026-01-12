import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api } from '../services/api'

interface User {
  id: number
  username: string
  email: string
  is_admin: boolean
  is_active: boolean
}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Check for existing token on mount
    const token = localStorage.getItem('token')
    if (token) {
      api.setToken(token)
      api.getMe()
        .then(userData => {
          setUser(userData)
        })
        .catch(() => {
          localStorage.removeItem('token')
          api.setToken(null)
        })
        .finally(() => {
          setIsLoading(false)
        })
    } else {
      setIsLoading(false)
    }
  }, [])

  const login = async (email: string, password: string) => {
    const response = await api.login(email, password)
    api.setToken(response.access_token)
    const userData = await api.getMe()
    setUser(userData)
  }

  const register = async (username: string, email: string, password: string) => {
    await api.register(username, email, password)
    // Auto-login after registration
    await login(email, password)
  }

  const logout = () => {
    api.setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
