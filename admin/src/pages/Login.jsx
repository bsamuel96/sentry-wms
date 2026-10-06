import { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // v1.4.2 #98: ChangePassword writes a flash message to sessionStorage
  // before resetting auth state, because React Router's location.state
  // does not survive the AuthProvider state flip that logout() triggers
  // between navigations. Read + clear on mount so the banner shows once
  // and a later login does not re-surface it.
  const [flashMessage, setFlashMessage] = useState(() => {
    try {
      return sessionStorage.getItem('login_flash_message') || '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    if (!flashMessage) return;
    try {
      sessionStorage.removeItem('login_flash_message');
    } catch { /* noop */ }
  }, [flashMessage]);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const userData = await login(username, password);
      if (userData && userData.role !== 'ADMIN') {
        // V-045: the login() context function already called /auth/logout
        // to clear the cookies for non-admin users. Just surface the error.
        setError('Nu ai drepturi de acces. Contactează administratorul.');
        setLoading(false);
        return;
      }
      navigate('/');
    } catch (err) {
      setError(
        err.message === 'Not authorized'
          ? 'Nu ai drepturi de acces. Contactează administratorul.'
          : 'Utilizator sau parolă incorectă.',
      );
      setPassword('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src="/icons/autosav-192.png" alt="" width="28" height="28" style={{ objectFit: 'contain' }} />
          Autosav WMS
        </div>
        {flashMessage && (
          <div
            role="status"
            className="login-success"
            style={{
              background: 'var(--success-bg, #e6f3ea)',
              color: 'var(--success, #0f5132)',
              padding: '10px 14px',
              borderRadius: 6,
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            {flashMessage}
          </div>
        )}
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Utilizator</label>
            <input
              className="form-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Parolă</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Se autentifică…' : 'Autentificare'}
          </button>
        </form>
      </div>
    </div>
  );
}
