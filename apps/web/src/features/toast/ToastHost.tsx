import { useEffect } from 'react';
import { useToast } from '../../stores/toast';
import { Icon } from '../../components/Icon';

export function ToastHost() {
  const items = useToast((s) => s.items);
  const dismiss = useToast((s) => s.dismiss);

  return (
    <div className="toast-host" aria-live="polite" aria-relevant="additions">
      {items.map((t) => (
        <ToastCard key={t.id} id={t.id} message={t.message} detail={t.detail} tone={t.tone} duration={t.duration} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  id,
  message,
  detail,
  tone,
  duration,
  onDismiss,
}: {
  id: string;
  message: string;
  detail?: string;
  tone: string;
  duration: number;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    if (duration <= 0) return;
    const timer = window.setTimeout(() => onDismiss(id), duration);
    return () => window.clearTimeout(timer);
  }, [id, duration, onDismiss]);

  return (
    <div className={`toast-item toast-${tone}`} role="status">
      <div className="toast-body">
        <div className="toast-msg">{message}</div>
        {detail && <div className="toast-detail">{detail}</div>}
      </div>
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(id)}
        aria-label="close"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
