import { Button } from "@shared/components/ui/button";
import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";
import { useClickOutside } from "@shared/hooks/useClickOutside";
import { useModalKeyboard } from "@shared/hooks/useKeyboard";

export function DeleteConfirmModal({ isOpen, onClose, onConfirm, isDeleting, itemName, title, description }) {
  const { t } = useTranslation(["inventory", "common"]);
  const resolvedTitle = title ?? t("deleteDialog.title");
  const modalRef = useClickOutside(!isDeleting ? onClose : null, isOpen);
  useModalKeyboard(!isDeleting ? onClose : null, isOpen);
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={!isDeleting ? onClose : undefined} />
      <div
        ref={modalRef}
        className="relative w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        data-keyboard-scope="modal"
        tabIndex={-1}
      >
        <button
          type="button"
          onClick={!isDeleting ? onClose : undefined}
          className="absolute right-3 top-3 p-1 text-muted-foreground hover:text-foreground"
          disabled={isDeleting}
          data-keyboard-cancel
          aria-label={t("deleteDialog.close")}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="mb-4 rounded-full bg-warn/10 p-3">
            <AlertTriangle className="h-6 w-6 text-warn" />
          </div>

          <h3 className="mb-2 text-lg font-semibold">{resolvedTitle}</h3>

          <p className="mb-4 text-sm text-muted-foreground">
            {t("deleteDialog.confirmLead", { item: itemName, description })}
          </p>

          <div className="flex w-full gap-3">
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={isDeleting}
              className="flex-1"
              data-keyboard-default
            >
              {isDeleting ? t("deleteDialog.removing") : t("deleteDialog.confirm")}
            </Button>
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isDeleting}
              className="flex-1"
              data-keyboard-cancel
            >
              Abbrechen
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
