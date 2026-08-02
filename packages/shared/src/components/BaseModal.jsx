import * as DialogPrimitive from '@radix-ui/react-dialog';

import { cn } from '../lib/utils.js';

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  full: 'max-w-full',
};

/**
 * Radix Dialog underneath, but the bottom-sheet-on-mobile / fullscreen layout
 * is ours — Radix has no opinion on either. Overlay and content stay inside one
 * positioned wrapper so `className` (callers pass `md:hidden` to make a modal
 * mobile-only) still hides the dimming layer along with the panel.
 *
 * Radix supplies what this used to hand-roll: focus trap, escape and
 * click-outside dismissal, scroll lock, and a generated id for aria-labelledby.
 */
export function BaseModal({ isOpen, onClose, title, children, size = 'md', className = '' }) {
  const isFullscreen = size === 'full';

  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <DialogPrimitive.Portal>
        <div
          className={cn(
            'fixed inset-0 z-50 flex',
            isFullscreen ? 'items-center justify-center' : 'items-end justify-center p-0 sm:items-center sm:p-4',
            className
          )}
        >
          <DialogPrimitive.Overlay className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />

          <DialogPrimitive.Content
            data-keyboard-scope="modal"
            aria-describedby={undefined}
            className={cn(
              'relative border border-border/75 bg-card/92 shadow-[0_24px_64px_rgba(0,0,0,0.45)] backdrop-blur-md',
              isFullscreen
                ? 'flex h-full w-full max-w-none flex-col overflow-hidden rounded-none border-0'
                : `w-full ${sizeClasses[size]} max-h-[92dvh] overflow-y-auto rounded-t-3xl border-x-0 border-b-0 sm:max-h-[90vh] sm:rounded-2xl sm:border`
            )}
          >
            {!isFullscreen ? (
              <div className="flex justify-center pt-2 sm:hidden">
                <span className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
              </div>
            ) : null}

            {/* Header */}
            <div
              className={cn(
                'flex items-center justify-between border-b border-border/70 bg-card/95 p-3 sm:p-6',
                isFullscreen ? 'shrink-0' : 'sticky top-0'
              )}
            >
              <DialogPrimitive.Title className="truncate text-base font-semibold sm:text-xl">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                className="ml-2 shrink-0 rounded-lg p-1 transition-colors hover:bg-accent/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                aria-label="Close"
                data-keyboard-cancel
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </DialogPrimitive.Close>
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
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
