import { t } from '../i18n/ro.js';

export default function PageHeader({ title, children }) {
  return (
    <div className="page-header">
      <h1>{t(title)}</h1>
      <div className="page-header-actions">{children}</div>
    </div>
  );
}
