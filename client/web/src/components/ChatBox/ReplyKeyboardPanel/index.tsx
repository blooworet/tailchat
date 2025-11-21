import React from 'react';
import type { ReplyKeyboardMeta } from '../../../../../shared/types';
import './styles.css';

type Props = {
  meta?: ReplyKeyboardMeta | null;
  disabled?: boolean;
  onClickButton?: (text: string) => void | Promise<void>;
  placeholder?: string;
};

export const ReplyKeyboardPanel: React.FC<Props> = ({ meta, disabled, onClickButton, placeholder }) => {
  if (!meta || meta.remove === true || !Array.isArray(meta.keyboard) || meta.keyboard.length === 0) {
    return null;
  }

  const [submitting, setSubmitting] = React.useState(false);
  const handleClick = async (text: string) => {
    if (disabled || submitting) return;
    try {
      setSubmitting(true);
      if (typeof onClickButton === 'function') {
        await onClickButton(text);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const ph = meta.placeholder || placeholder || '';

  return (
    <div className={`tc-rk-panel ${meta.resize ? 'rk-resize' : ''}`} aria-label="reply-keyboard">
      {ph ? <div className="tc-rk-placeholder">{ph}</div> : null}
      <div className="tc-rk-grid">
        {meta.keyboard.map((row, i) => (
          <div className="tc-rk-row" key={`rk-row-${i}`}>
            {row.map((btn, j) => (
              <button
                key={`rk-btn-${i}-${j}`}
                type="button"
                className="tc-rk-btn"
                onClick={() => handleClick(btn.text)}
                disabled={!!disabled || submitting}
              >
                {btn.text}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ReplyKeyboardPanel;
