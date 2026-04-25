// client/src/utils/keyboard.js
// Reusable keyboard-navigation hooks used across the app.
import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Trap Tab focus within a container (use in modals/dialogs).
 * Returns a ref to attach to the container element.
 *   const trapRef = useFocusTrap();
 *   <div ref={trapRef}> ... </div>
 */
export function useFocusTrap(active = true) {
  const ref = useRef(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;

    // Auto-focus first non-close focusable element
    setTimeout(() => {
      const first = container.querySelector(
        'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),' +
        'button:not([disabled]):not(.close-x)'
      );
      if (first) first.focus();
    }, 60);

    const handler = (e) => {
      if (e.key !== 'Tab') return;
      const items = [...container.querySelectorAll(FOCUSABLE)].filter(
        (el) => getComputedStyle(el).display !== 'none' && !el.closest('[hidden]')
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    container.addEventListener('keydown', handler);
    return () => container.removeEventListener('keydown', handler);
  }, [active]);

  return ref;
}

/**
 * Call fn when Escape is pressed (captures at window level).
 */
export function useEscapeKey(fn) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && fnRef.current) fnRef.current(e); };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);
}

/**
 * Arrow key navigation within a list container.
 *   const ref = useArrowNav();
 *   <ul ref={ref}> <li tabIndex={0}>…</li> </ul>
 */
export function useArrowNav(itemSelector = '[tabindex="0"]') {
  const ref = useRef(null);
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const handler = (e) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      const items = [...container.querySelectorAll(itemSelector)].filter(
        (el) => getComputedStyle(el).display !== 'none' && !el.disabled
      );
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement);
      if (idx === -1) return;
      e.preventDefault();
      if (e.key === 'ArrowDown') items[Math.min(idx + 1, items.length - 1)].focus();
      if (e.key === 'ArrowUp')   items[Math.max(idx - 1, 0)].focus();
      if (e.key === 'Home')      items[0].focus();
      if (e.key === 'End')       items[items.length - 1].focus();
    };
    container.addEventListener('keydown', handler);
    return () => container.removeEventListener('keydown', handler);
  }, [itemSelector]);
  return ref;
}
