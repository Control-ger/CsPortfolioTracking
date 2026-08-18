import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Callout } from './ui/callout.jsx';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function ExcludeInvestmentDialog({
  isOpen,
  onOpenChange,
  investment,
  onConfirm,
  isLoading = false
}) {
  const { t } = useTranslation(['inventory', 'common']);
  const itemName = investment?.name || t('excludeDialog.item');
  const isCurrentlyExcluded = investment?.excluded || false;
  const action = isCurrentlyExcluded
    ? t('excludeDialog.reIncluded')
    : t('excludeDialog.excluded');

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-border/60">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-warn" />
            <AlertDialogTitle>
              {isCurrentlyExcluded
                ? t('excludeDialog.titleInclude')
                : t('excludeDialog.titleExclude')}
            </AlertDialogTitle>
          </div>
        </AlertDialogHeader>

        <AlertDialogDescription className="space-y-3 text-sm">
          <p>{t('excludeDialog.lead', { item: itemName, action })}</p>

          {!isCurrentlyExcluded && (
            <Callout tone="warn" title={t('excludeDialog.consequences')}>
              <ul className="mt-1 list-inside list-disc space-y-1">
                <li>{t('excludeDialog.excludeBullet1')}</li>
                <li>{t('excludeDialog.excludeBullet2')}</li>
                <li>{t('excludeDialog.excludeBullet3')}</li>
                <li>{t('excludeDialog.excludeBullet4')}</li>
              </ul>
            </Callout>
          )}

          {isCurrentlyExcluded && (
            <Callout tone="info" title={t('excludeDialog.includeLead')}>
              <ul className="mt-1 list-inside list-disc space-y-1">
                <li>{t('excludeDialog.includeBullet1')}</li>
                <li>{t('excludeDialog.includeBullet2')}</li>
              </ul>
            </Callout>
          )}
        </AlertDialogDescription>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>
            {t('actions.cancel', { ns: 'common' })}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onConfirm(!isCurrentlyExcluded)}
            disabled={isLoading}
            className={`font-semibold shadow-sm transition-all hover:scale-[1.02] ${
              isCurrentlyExcluded
                ? 'bg-info text-primary-foreground hover:bg-info/90'
                : 'bg-warn text-primary-foreground hover:bg-warn/90'
            }`}
          >
            {isLoading
              ? t('excludeDialog.saving')
              : isCurrentlyExcluded
                ? t('excludeDialog.include')
                : t('excludeDialog.exclude')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
