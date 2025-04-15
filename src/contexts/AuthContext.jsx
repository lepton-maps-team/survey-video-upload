import { createContext, useContext, useState, useEffect } from 'react'

// Create auth context
const AuthContext = createContext(null)

// Context provider component
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check for stored user on component mount
    const storedUser = localStorage.getItem('user')
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser))
      } catch (error) {
        console.error('Error parsing stored user:', error)
        localStorage.removeItem('user')
      }
    }
    setLoading(false)
  }, [])

  // Login function - store user data
  const login = async (userData) => {
    setUser(userData)
    localStorage.setItem('user', JSON.stringify(userData))
    return userData
  }

  // Logout function - clear user data
  const logout = () => {
    setUser(null)
    localStorage.removeItem('user')
  }

  // Auth context value
  const value = {
    user,
    loading,
    login,
    logout,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    isManager: user?.role === 'manager',
    isSurveyor: user?.role === 'surveyor'
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

// Custom hook to use the auth context
export function useAuth() {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
} 