// client/src/components/KeyboardProvider.js
// Global keyboard navigation layer — applied once at the app root.
// Provides:
//   • '/'            → focus the first visible search input
//   • 'Escape'       → close the topmost open modal/overlay
//   • ArrowUp/Down   → navigate sidebar links & focused table rows
//   • Enter/Space    → activate button-role elements (.fchip, .clickable tr)
//   • Tab (in modal) → trap focus inside the topmost overlay
//   • Auto-focus     → first input in a modal when it opens
//   • a11y inject    → adds tabIndex/role to .fchip and clickable table rows

import { useEffect } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function injectAccessibility(root) {
  // Filter chips — make them keyboard-activatable
  root.querySelectorAll('.fchip:not([role])').forEach((el) => {
    el.setAttribute('role', 'button');
    if (!el.getAttribute('tabindex')) el.setAttribute('tabindex', '0');
  });
  // Clickable table rows
  root.querySelectorAll('tbody tr.clickable:not([tabindex])').forEach((el) => {
    el.setAttribute('tabindex', '0');
  });
}

export default function KeyboardProvider({ children }) {

  // ── Inject a11y attributes on mount + whenever DOM changes ──────────────────
  useEffect(() => {
    injectAccessibility(document.body);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) =>
        m.addedNodes.forEach((node) => {
          if (node.nodeType === 1) injectAccessibility(node);
        })
      );
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // ── Auto-focus first input when a modal/overlay opens ───────────────────────
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) =>
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          const overlay =
            node.classList?.contains('overlay') ? node : node.querySelector?.('.overlay');
          if (!overlay) return;
          setTimeout(() => {
            const first = overlay.querySelector(
              'input:not([disabled]),select:not([disabled]),' +
              'textarea:not([disabled]),button:not([disabled]):not(.close-x)'
            );
            if (first) first.focus();
          }, 60);
        })
      );
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // ── Global keyboard handler ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      const active = document.activeElement;
      const tag = active?.tagName;
      const inInput =
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) ||
        active?.isContentEditable;

      // ── Tab: trap focus inside topmost overlay ─────────────────────────────
      if (e.key === 'Tab') {
        const overlays = [...document.querySelectorAll('.overlay')];
        if (overlays.length) {
          const top = overlays[overlays.length - 1];
          const items = [...top.querySelectorAll(FOCUSABLE)].filter(
            (el) =>
              getComputedStyle(el).display !== 'none' &&
              getComputedStyle(el).visibility !== 'hidden'
          );
          if (items.length) {
            const first = items[0];
            const last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
        return;
      }

      // ── Escape: close topmost overlay ─────────────────────────────────────
      if (e.key === 'Escape') {
        const overlays = [...document.querySelectorAll('.overlay')];
        if (overlays.length) {
          const top = overlays[overlays.length - 1];
          const closeBtn = top.querySelector('.close-x, [data-modal-close]');
          if (closeBtn) { e.stopPropagation(); closeBtn.click(); }
          else {
            // Simulate backdrop click
            top.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
        }
        return;
      }

      // ── '/' : focus search ─────────────────────────────────────────────────
      if (e.key === '/' && !inInput) {
        e.preventDefault();
        const search = document.querySelector('.search-input:not([disabled])');
        if (search) { search.focus(); search.select(); }
        return;
      }

      // ── Enter / Space: activate button-role elements ───────────────────────
      if ((e.key === 'Enter' || e.key === ' ') && !inInput) {
        if (
          active?.getAttribute('role') === 'button' ||
          active?.classList.contains('fchip')
        ) {
          e.preventDefault();
          active.click();
          return;
        }
        // Clickable table row
        if (active?.tagName === 'TR') {
          e.preventDefault();
          active.click();
          return;
        }
      }

      // ── Arrow keys: sidebar nav ────────────────────────────────────────────
      if (['ArrowUp', 'ArrowDown'].includes(e.key) && !inInput) {
        const sbNav = document.querySelector('.sb-nav');
        if (sbNav && sbNav.contains(active)) {
          const items = [...sbNav.querySelectorAll('a.nav-item')];
          const idx = items.indexOf(active);
          if (idx !== -1) {
            e.preventDefault();
            if (e.key === 'ArrowDown') items[Math.min(idx + 1, items.length - 1)]?.focus();
            if (e.key === 'ArrowUp')   items[Math.max(idx - 1, 0)]?.focus();
            return;
          }
        }
      }

      // ── Arrow keys: table row navigation ──────────────────────────────────
      if (['ArrowUp', 'ArrowDown'].includes(e.key) && !inInput) {
        if (active?.tagName === 'TR' && active.parentElement?.tagName === 'TBODY') {
          const rows = [...active.parentElement.querySelectorAll('tr[tabindex]')];
          const idx = rows.indexOf(active);
          if (idx !== -1) {
            e.preventDefault();
            if (e.key === 'ArrowDown') rows[Math.min(idx + 1, rows.length - 1)]?.focus();
            if (e.key === 'ArrowUp')   rows[Math.max(idx - 1, 0)]?.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return children;
}
