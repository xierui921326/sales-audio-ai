import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface ConfigSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface ConfigSelectProps {
  value: string;
  options: ConfigSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  renderValue?: (option?: ConfigSelectOption) => React.ReactNode;
  renderOption?: (option: ConfigSelectOption, state: { selected: boolean }) => React.ReactNode;
}

export default function ConfigSelect({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled = false,
  className,
  renderValue,
  renderOption,
}: ConfigSelectProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = useMemo(
    () => options.find(option => option.value === value),
    [options, value]
  );

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (wrapperRef.current && !wrapperRef.current.contains(target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className={className ? `preset-wrapper ${className}` : 'preset-wrapper'} ref={wrapperRef}>
      <button
        type="button"
        className={`preset-trigger ${open ? 'is-open' : ''}`}
        onClick={() => {
          if (!disabled) {
            setOpen(prev => !prev);
          }
        }}
        disabled={disabled}
      >
        <span className="preset-trigger__text">
          {renderValue ? renderValue(selectedOption) : selectedOption?.label || placeholder}
        </span>
        <span className="preset-trigger__arrow" aria-hidden="true">
          <span className="icon-shape icon-shape--chevron" />
        </span>
      </button>

      {open ? (
        <div className="preset-menu">
          {options.map(option => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                className={`preset-menu__item ${selected ? 'is-active' : ''}`}
                disabled={option.disabled}
                onClick={() => {
                  if (option.disabled) {
                    return;
                  }
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {renderOption ? (
                  renderOption(option, { selected })
                ) : (
                  <span className="preset-menu__label">{option.label}</span>
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
