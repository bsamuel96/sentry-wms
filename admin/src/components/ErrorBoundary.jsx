import React from 'react';
import { logBoundaryError } from '../utils/safeLogging';
import { t } from '../i18n/ro.js';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // V-020: scrub Bearer tokens, JWTs, and URL userinfo before logging.
    // In production only a minimal error name + message is written.
    logBoundaryError(error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          background: '#f4f6f8',
          border: '1px solid #d7e4f2',
          borderRadius: '8px',
          margin: '1rem'
        }}>
          <h2 style={{ color: '#c62828' }}>A apărut o problemă</h2>
          <p style={{ color: '#666' }}>
            {this.props.fallbackMessage
              ? t(this.props.fallbackMessage)
              : 'Această secțiune a întâmpinat o eroare. Încearcă să reîncarci pagina.'}
          </p>
          <button
            onClick={this.reset}
            style={{
              background: '#0b63d6',
              color: 'white',
              border: 'none',
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Reîncearcă
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
