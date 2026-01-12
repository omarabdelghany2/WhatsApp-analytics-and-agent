import { createContext, useContext, useEffect, useState, useRef, ReactNode, useCallback } from 'react'
import { api } from '../services/api'

interface WebSocketContextType {
  isConnected: boolean
  lastMessage: WebSocketMessage | null
  subscribe: (eventType: string, callback: (data: WebSocketMessage) => void) => () => void
}

interface WebSocketMessage {
  type: string
  [key: string]: unknown
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined)

// Detect environment at runtime
const WS_URL = window.location.hostname === 'localhost'
  ? 'ws://localhost:8000/ws'
  : 'wss://backend-production-d7e2.up.railway.app/ws'

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const listenersRef = useRef<Map<string, Set<(data: WebSocketMessage) => void>>>(new Map())
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const isConnectingRef = useRef(false)
  const isMountedRef = useRef(true)
  const maxReconnectAttempts = 5

  const connect = useCallback(() => {
    const token = api.getToken()
    if (!token || isConnectingRef.current || !isMountedRef.current) {
      return
    }

    // Already connected
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return
    }

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    isConnectingRef.current = true

    try {
      console.log('[WS] Connecting...')
      const ws = new WebSocket(`${WS_URL}?token=${token}`)

      ws.onopen = () => {
        if (!isMountedRef.current) {
          ws.close()
          return
        }
        console.log('[WS] Connected')
        setIsConnected(true)
        reconnectAttemptsRef.current = 0
        isConnectingRef.current = false
      }

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return

        try {
          const data = JSON.parse(event.data) as WebSocketMessage
          console.log('[WS] Message received:', data.type)
          setLastMessage(data)

          // Notify subscribers
          const typeListeners = listenersRef.current.get(data.type)
          if (typeListeners) {
            typeListeners.forEach(callback => callback(data))
          }

          // Notify wildcard subscribers
          const wildcardListeners = listenersRef.current.get('*')
          if (wildcardListeners) {
            wildcardListeners.forEach(callback => callback(data))
          }
        } catch (error) {
          console.error('[WS] Failed to parse message:', error)
        }
      }

      ws.onclose = (event) => {
        console.log('[WS] Disconnected', event.code, event.reason)
        setIsConnected(false)
        wsRef.current = null
        isConnectingRef.current = false

        // Only attempt reconnection if still mounted and not a clean close
        if (isMountedRef.current && event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000)
          console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`)
          reconnectTimeoutRef.current = setTimeout(connect, delay)
        }
      }

      ws.onerror = (error) => {
        console.error('[WS] Error:', error)
        isConnectingRef.current = false
      }

      wsRef.current = ws
    } catch (error) {
      console.error('[WS] Failed to create WebSocket:', error)
      isConnectingRef.current = false
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true

    const token = api.getToken()
    if (token) {
      // Small delay to avoid StrictMode double-invoke issues
      const timeoutId = setTimeout(connect, 100)
      return () => {
        clearTimeout(timeoutId)
      }
    }
  }, [connect])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting')
        wsRef.current = null
      }
    }
  }, [])

  const subscribe = useCallback((eventType: string, callback: (data: WebSocketMessage) => void) => {
    if (!listenersRef.current.has(eventType)) {
      listenersRef.current.set(eventType, new Set())
    }
    listenersRef.current.get(eventType)!.add(callback)

    // Return unsubscribe function
    return () => {
      listenersRef.current.get(eventType)?.delete(callback)
    }
  }, [])

  return (
    <WebSocketContext.Provider value={{ isConnected, lastMessage, subscribe }}>
      {children}
    </WebSocketContext.Provider>
  )
}

export function useWebSocket() {
  const context = useContext(WebSocketContext)
  if (context === undefined) {
    throw new Error('useWebSocket must be used within WebSocketProvider')
  }
  return context
}
