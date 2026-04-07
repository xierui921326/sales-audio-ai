import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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

interface MenuPosition {
  top: number;
  left: number;
  width: number;
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
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = useMemo(
    () => options.find(option => option.value === value),
    [options, value]
  );

  useEffect(() => {
    function updateMenuPosition() {
      if (!triggerRef.current) {
        return;
      }

      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      });
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      const clickedTriggerArea = wrapperRef.current?.contains(target);
      const clickedMenu = menuRef.current?.contains(target);

      if (!clickedTriggerArea && !clickedMenu) {
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

    if (open) {
      updateMenuPosition();
      window.addEventListener('resize', updateMenuPosition);
      window.addEventListener('scroll', updateMenuPosition, true);
    }

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open]);

  return (
    <div className={className ? `preset-wrapper ${className}` : 'preset-wrapper'} ref={wrapperRef}>
      <button
        ref={triggerRef}
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

      {open && menuPosition ? createPortal(
        <div
          ref={menuRef}
          className="preset-menu"
          style={{
            position: 'fixed',
            top: `${menuPosition.top}px`,
            left: `${menuPosition.left}px`,
            width: `${menuPosition.width}px`,
          }}
        >
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
        </div>,
        document.body
      ) : null}
    </div>
  );
}
