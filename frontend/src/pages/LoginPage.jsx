import { useState } from 'react'
import { loginUser } from '../api/authApi'

function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (username.trim() === '') {
      alert('Username is required')
      return
    }

    if (password.trim() === '') {
      alert('Password is required')
      return
    }

    try {
      setLoading(true)

      const loggedInUser = await loginUser(username, password)

      onLogin(loggedInUser)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Hydrocarbon Accounting System</h1>
        <p>Login to continue</p>

        <form onSubmit={handleSubmit} className="login-form">
          <div>
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoFocus
            />
          </div>

          <div>
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
            />
          </div>

          <div className="form-actions">
            <button type="submit" disabled={loading}>
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </div>
        </form>

        <div className="info-box">
          Use your User Master username and password. Role and permissions are
          loaded automatically after login.
        </div>
      </div>
    </div>
  )
}

export default LoginPage