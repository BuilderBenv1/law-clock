'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Free-text field with a picker of what has been typed before.
 *
 * The lawyer types what they are doing; anything they have logged for this
 * client before is offered back so recurring work keeps one consistent name and
 * its hours accumulate under a single heading. Typing filters the list, but a
 * new value is always allowed — the list is a shortcut, never a constraint.
 */
export function Combobox({
  name,
  options,
  placeholder,
  emptyHint,
  defaultValue = '',
  autoFocus = false,
  required = false,
}: {
  name: string;
  options: string[];
  placeholder?: string;
  emptyHint?: string;
  defaultValue?: string;
  autoFocus?: boolean;
  required?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const pool = options.filter(Boolean);
    if (!q) return pool.slice(0, 8);
    return pool.filter((o) => o.toLowerCase().includes(q) && o.toLowerCase() !== q).slice(0, 8);
  }, [options, value]);

  // Close when focus or a click lands outside the control.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function choose(option: string) {
    setValue(option);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (!open || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter' && matches[active]) {
      // Only steal Enter while a suggestion is highlighted, so typing a brand
      // new task and hitting Enter still submits the form.
      e.preventDefault();
      choose(matches[active]!);
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <input
        name={name}
        className="input"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        required={required}
        onChange={(e) => {
          setValue(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full rounded-md border border-slate-700 bg-slate-900 shadow-xl overflow-hidden">
          {emptyHint && (
            <li className="px-3 py-1.5 text-[11px] text-slate-500 border-b border-slate-800">{emptyHint}</li>
          )}
          {matches.map((option, i) => (
            <li key={option}>
              <button
                type="button"
                className={`w-full text-start px-3 py-2 text-sm ${
                  i === active ? 'bg-slate-700/70 text-white' : 'text-slate-200 hover:bg-slate-800'
                }`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(option)}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
