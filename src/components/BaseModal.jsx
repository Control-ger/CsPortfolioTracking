import { useEffect, useRef } from 'react';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useModalKeyboard } from '@/hooks/useKeyboard';

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
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${isFullscreen ? '' : 'p-2 sm:p-4'} ${className}`}>
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className={[
          'relative bg-background shadow-lg border',
          isFullscreen
            ? 'h-full w-full max-w-none rounded-none border-0 overflow-hidden flex flex-col'
            : `rounded-lg ${sizeClasses[size]} w-full max-h-[90vh] overflow-y-auto`,
        ].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Header */}
        <div className={`flex items-center justify-between border-b bg-background p-3 sm:p-6 ${isFullscreen ? 'shrink-0' : 'sticky top-0'}`}>
          <h2 id="modal-title" className="text-base sm:text-xl font-semibold truncate">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded-md transition-colors shrink-0 ml-2"
            aria-label="Close"
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
        <div className={isFullscreen ? 'flex-1 overflow-hidden p-3 sm:p-6 md:pb-6' : 'p-3 sm:p-6'}>{children}</div>
      </div>
    </div>
  );
}
