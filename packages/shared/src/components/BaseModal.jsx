import { useEffect } from 'react';
import { useClickOutside } from '../hooks/useClickOutside.js';
import { useModalKeyboard } from '../hooks/useKeyboard.js';

export function BaseModal({ isOpen, onClose, title, children, size = 'md', className = '' }) {
  // Handle click outside and ESC key
  const modalRef = useClickOutside(onClose, isOpen);
  useModalKeyboard(onClose, isOpen);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    full: 'max-w-full',
  };

  const isFullscreen = size === 'full';

  return (
    <div className={`fixed inset-0 z-50 flex ${isFullscreen ? 'items-center justify-center' : 'items-end justify-center sm:items-center'} ${isFullscreen ? '' : 'p-0 sm:p-4'} ${className}`}>
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className={[
          'relative border border-border/75 bg-card/92 shadow-[0_24px_64px_rgba(0,0,0,0.45)] backdrop-blur-md',
          isFullscreen
            ? 'h-full w-full max-w-none rounded-none border-0 overflow-hidden flex flex-col'
            : `w-full ${sizeClasses[size]} max-h-[92dvh] overflow-y-auto rounded-t-3xl border-x-0 border-b-0 sm:max-h-[90vh] sm:rounded-2xl sm:border`,
        ].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        data-keyboard-scope="modal"
        tabIndex={-1}
      >
        {!isFullscreen ? (
          <div className="flex justify-center pt-2 sm:hidden">
            <span className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
          </div>
        ) : null}

        {/* Header */}
        <div className={`flex items-center justify-between border-b border-border/70 bg-card/95 p-3 sm:p-6 ${isFullscreen ? 'shrink-0' : 'sticky top-0'}`}>
          <h2 id="modal-title" className="text-base sm:text-xl font-semibold truncate">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-2 shrink-0 rounded-lg p-1 transition-colors hover:bg-accent/75"
            aria-label="Close"
            data-keyboard-cancel
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div
          className={
            isFullscreen
              ? 'flex-1 overflow-hidden p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-6 md:pb-6'
              : 'p-3 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-6'
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
