import React, { useId } from 'react';

export type DialogTone = 'success' | 'error' | 'info' | 'advisory';

interface DialogProps {
  tone: DialogTone;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  onClose?: () => void;
  closeOnOverlay?: boolean;
  size?: 'default' | 'compact';
}

const DIALOG_TONE_LABELS: Record<DialogTone, string> = {
  success: '成功',
  error: '错误',
  info: '提示',
  advisory: '提醒',
};

export default function Dialog({
  tone,
  title,
  description,
  children,
  actions,
  onClose,
  closeOnOverlay = true,
  size = 'default',
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const handleOverlayClick = closeOnOverlay && onClose ? onClose : undefined;

  return (
    <div className="dialog-overlay" onClick={handleOverlayClick}>
      <div
        className={`dialog-card ${size === 'compact' ? 'dialog-card--compact' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onClick={event => event.stopPropagation()}
      >
        <div className="dialog-header">
          <div className="dialog-header-top">
            <div className={`dialog-badge dialog-badge--${tone}`}>{DIALOG_TONE_LABELS[tone]}</div>
            {onClose ? (
              <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭弹窗">
                <span className="icon-shape icon-shape--close" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="dialog-heading">
            <div className="dialog-title" id={titleId}>{title}</div>
            {description ? <div className="dialog-description" id={descriptionId}>{description}</div> : null}
          </div>
        </div>
        {children ? <div className="dialog-body">{children}</div> : null}
        {actions ? <div className="dialog-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
