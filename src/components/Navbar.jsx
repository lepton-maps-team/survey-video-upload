import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import '../styles/Navbar.css'

function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  if (!user) return null

  return (
    <nav className="navbar">
      <div className="navbar-brand">Survey Video Manager</div>
      <div className="navbar-user">
        <span className="user-info">
          <span className="username">{user.username}</span>
          <span className="role-badge">{user.role}</span>
        </span>
        <button onClick={handleLogout} className="logout-button">
          Logout
        </button>
      </div>
    </nav>
  )
}

export default Navbar 