import { Button } from "@/components/ui/button";
import { AlertTriangle, X } from "lucide-react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { useModalKeyboard } from "@/hooks/useKeyboard";

export function DeleteConfirmModal({ isOpen, onClose, onConfirm, isDeleting, itemName, title = "Item entfernen?", description }) {
  const modalRef = useClickOutside(!isDeleting ? onClose : null, isOpen);
  useModalKeyboard(!isDeleting ? onClose : null, isOpen);
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={!isDeleting ? onClose : undefined} />
      <div ref={modalRef} className="relative w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg">
        <button
          onClick={!isDeleting ? onClose : undefined}
          className="absolute right-3 top-3 p-1 text-muted-foreground hover:text-foreground"
          disabled={isDeleting}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="mb-4 rounded-full bg-amber-100 p-3 dark:bg-amber-900/30">
            <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>

          <h3 className="mb-2 text-lg font-semibold">{title}</h3>

          <p className="mb-4 text-sm text-muted-foreground">
            Möchtest du <span className="font-medium text-foreground">{itemName}</span> wirklich {description}?
          </p>

          <div className="flex w-full gap-3">
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={isDeleting}
              className="flex-1"
            >
              {isDeleting ? "Wird entfernt..." : "Ja, entfernen"}
            </Button>
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isDeleting}
              className="flex-1"
            >
              Abbrechen
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
