import React from 'react';

export default function Toggle({ checked = false, onChange, name, label, disabled = false }) {
  const isChecked = Boolean(checked);
  const labelId = `${name}-toggle-label`;

  const emitChange = () => {
    if (typeof onChange === 'function') {
      onChange({
        target: {
          name,
          checked: !isChecked,
          type: 'checkbox'
        }
      });
    }
  };

  const handleInteraction = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (disabled) {
      return;
    }

    emitChange();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      handleInteraction(event);
    }
  };

  const trackClasses = [
    'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-1',
    disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
    isChecked ? 'bg-slate-700' : 'bg-slate-300',
    !disabled && (isChecked ? 'hover:bg-slate-800' : 'hover:bg-slate-400')
  ]
    .filter(Boolean)
    .join(' ');

  const thumbClasses = [
    'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200',
    isChecked ? 'translate-x-5' : 'translate-x-1'
  ].join(' ');

  return (
    <div className={`flex items-center gap-3 ${disabled ? 'cursor-not-allowed' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={isChecked}
        aria-labelledby={labelId}
        aria-disabled={disabled}
        onClick={handleInteraction}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={trackClasses}
      >
        <span className={thumbClasses} />
      </button>
      <span
        id={labelId}
        className={`text-sm text-slate-700 ${disabled ? 'opacity-60' : ''}`}
        onClick={!disabled ? handleInteraction : undefined}
      >
        {label}
      </span>
    </div>
  );
}
