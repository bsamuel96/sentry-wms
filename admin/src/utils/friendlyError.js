/**
 * V-021: map backend error responses to user-friendly strings.
 *
 * The admin SPA used to render `data.error` verbatim, which surfaced
 * backend internals (SQL constraint names, Python exception reprs) to
 * end users. This helper converts a response payload to a finite,
 * human-readable message. Anything not explicitly mapped falls back to
 * a generic message and never echoes the raw backend string.
 */

// Backend-defined `error` values that are safe to surface as-is because
// they are end-user oriented (not internal diagnostics). Keys map to
// the user-facing string the UI should show.
const KNOWN_ERROR_MESSAGES = {
  validation_error: 'Unul sau mai multe câmpuri conțin valori nevalide.',
  unsupported_media_type: 'Formatul cererii nu este acceptat.',
  'Invalid username or password': 'Utilizator sau parolă incorectă.',
  'Account disabled or deleted': 'Contul nu mai este activ. Contactează un administrator.',
  'Token expired': 'Sesiunea a expirat. Autentifică-te din nou.',
  Unauthorized: 'Trebuie să te autentifici pentru a continua.',
  Forbidden: 'Nu ai permisiunea necesară pentru această acțiune.',
  'CSRF token missing or invalid': 'Sesiunea nu mai este sincronizată. Reîncarcă pagina și încearcă din nou.',
  'Access denied for this warehouse': 'Nu ai acces la acest depozit.',
  'Current password is incorrect': 'Parola actuală este incorectă.',
  'User not found': 'Contul nu a fost găsit.',
  "Password cannot be 'admin'": 'Parola nu poate fi „admin”.',
  'Password must be at least 8 characters': 'Parola trebuie să aibă minimum 8 caractere.',
  'Password must contain at least one letter': 'Parola trebuie să conțină cel puțin o literă.',
  'Password must contain at least one digit': 'Parola trebuie să conțină cel puțin o cifră.',
  password_change_required: 'Trebuie să schimbi parola înainte de a continua.',
};

export function friendlyError(payload, fallback = 'A apărut o problemă. Încearcă din nou.') {
  if (!payload || typeof payload !== 'object') return fallback;
  const code = payload.error;
  if (code && Object.prototype.hasOwnProperty.call(KNOWN_ERROR_MESSAGES, code)) {
    return KNOWN_ERROR_MESSAGES[code];
  }
  return fallback;
}

/**
 * Resolve a friendly error from a fetch Response. Reads the JSON body
 * (if any) and maps via friendlyError. Use this when you have a non-ok
 * Response and want the right user-facing string.
 */
export async function friendlyErrorFromResponse(res, fallback) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return friendlyError(body, fallback);
}
