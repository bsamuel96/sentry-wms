import { useEffect, useId, useRef } from 'react';
import { t } from '../i18n/ro.js';

// onBack is optional. When supplied, a back arrow renders in the header's
// top-left and the title shifts right to make room. Used by the SO modal's
// Related Records tab, where clicking a related record swaps the modal's
// contents in place and the operator needs a way back to where they
// started. Omitting it renders exactly what every other caller renders.
export default function Modal({ title, onClose, children, footer, size, onBack, backLabel }) {
  const className = size ? `modal modal-${size}` : 'modal';
  const titleId = useId();
  const modalRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    modalRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex="-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          {onBack && (
            <button
              type="button"
              className="modal-back"
              onClick={onBack}
              aria-label={backLabel ? `Înapoi la ${t(backLabel)}` : 'Înapoi'}
              title={backLabel ? `Înapoi la ${t(backLabel)}` : 'Înapoi'}
              data-testid="modal-back"
            >
              &#8592;
            </button>
          )}
          <h2 id={titleId}>{t(title)}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Închide">&times;</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
