import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { friendlyError } from '../utils/friendlyError.js';

export default function ChangePassword() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const forced = !!user?.must_change_password;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Parolele noi nu coincid.');
      return;
    }

    setSubmitting(true);
    const res = await api.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });

    if (!res || !res.ok) {
      const data = res ? await res.json().catch(() => ({})) : {};
      setError(friendlyError(data, 'Parola nu a putut fi schimbată. Încearcă din nou.'));
      setSubmitting(false);
      return;
    }

    // v1.4.2 #98: /auth/change-password intentionally invalidates the
    // session token server-side. Calling refreshUser() (/auth/me) with
    // the now-dead token 401s and leaves the stale must_change_password
    // flag in context; the router guard then bounces the operator back
    // to /change-password and the screen appears twice. Reuse logout()
    // to clear local auth state (one function owns auth reset) and send
    // the operator to /login with a success message. sessionStorage
    // carries the message so it survives the AuthProvider state flip
    // that logout() triggers; Login reads + clears it on mount.
    try {
      sessionStorage.setItem(
        'login_flash_message',
        'Parola a fost schimbată. Autentifică-te folosind noua parolă.',
      );
    } catch {
      // Private mode or disabled storage: operator still gets a
      // working /login page, just without the confirmation banner.
    }
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div style={{ padding: 24, maxWidth: 480 }}>
      {forced && (
        <div
          role="alert"
          className="forced-change-banner"
          style={{
            background: '#0b63d6',
            color: '#ffffff',
            padding: '14px 18px',
            borderRadius: 6,
            marginBottom: 20,
            fontSize: 14,
            lineHeight: 1.4,
          }}
        >
          <strong>Configurare inițială:</strong> alege o parolă nouă de administrator înainte de a continua.
        </div>
      )}

      <h2 style={{ marginTop: 0, marginBottom: 20 }}>Schimbare parolă</h2>

      {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Parola actuală</label>
          <input
            className="form-input"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="form-group">
          <label>Parola nouă</label>
          <input
            className="form-input"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 6 }}>
            Minimum 8 caractere, cel puțin o literă și o cifră. Nu poate fi „admin”.
          </div>
        </div>

        <div className="form-group">
          <label>Confirmă parola nouă</label>
          <input
            className="form-input"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Se salvează…' : 'Schimbă parola'}
          </button>
          {!forced && (
            <button
              type="button"
              className="btn"
              onClick={() => navigate(-1)}
              disabled={submitting}
            >
              Anulează
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
