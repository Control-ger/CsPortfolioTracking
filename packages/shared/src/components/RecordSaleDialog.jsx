import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Callout } from "./ui/callout.jsx";
import { useCurrency } from "../contexts/CurrencyContext";

/** Today in the `yyyy-mm-dd` shape a date input expects, in local time. */
function todayInputValue() {
  const now = new Date();
  const offsetMinutes = now.getTimezoneOffset();
  return new Date(now.getTime() - offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/**
 * Record a sale of a held position.
 *
 * The manual counterpart to the CSFloat importer, for Steam Market, P2P and
 * anything else no API covers. Both write through `recordSale`, so allocation,
 * deduplication and the sync queue behave identically.
 *
 * The price is entered in the display currency and converted to USD, matching
 * how purchase prices are captured — the store persists USD.
 */
export function RecordSaleDialog({
  isOpen,
  onOpenChange,
  item,
  availableQuantity,
  onConfirm,
  isLoading = false,
}) {
  const { t } = useTranslation(["inventory", "common"]);
  const { currency, convertToUsd } = useCurrency();
  const maxQuantity = Math.max(1, Number(availableQuantity || item?.quantity || 1));

  // The caller mounts this only while the dialog is open, so every open starts
  // from these initial values — no reset effect, and no stale entry carried
  // over from the previous position.
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [soldAt, setSoldAt] = useState(todayInputValue);
  const [platform, setPlatform] = useState("steam");
  const [error, setError] = useState("");
  // A recorded sale the portfolio could not fully cover. Reported here rather
  // than closing on it: the number is the user's cue that the realised figure
  // rests on fewer units than they sold.
  const [shortfall, setShortfall] = useState(0);

  const parsedQuantity = Number(quantity);
  const parsedPrice = Number(String(price).replace(",", "."));

  const handleSubmit = async () => {
    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 1) {
      setError(t("recordSale.errorQuantity"));
      return;
    }
    if (parsedQuantity > maxQuantity) {
      setError(t("recordSale.errorQuantityMax", { max: maxQuantity }));
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setError(t("recordSale.errorPrice"));
      return;
    }

    setError("");
    // Per unit, matching how `buy_price_usd` is stored.
    const unitPriceUsd =
      typeof convertToUsd === "function" ? convertToUsd(parsedPrice) : parsedPrice;

    const result = await onConfirm?.({
      itemId: item?.itemId ? String(item.itemId) : null,
      name: item?.marketHashName || item?.name || "",
      quantity: Math.floor(parsedQuantity),
      sellPriceUsd: unitPriceUsd,
      soldAt: new Date(`${soldAt}T12:00:00Z`).toISOString(),
      platform,
    });

    const unallocated = Number(result?.unallocated || 0);
    if (unallocated > 0) {
      setShortfall(unallocated);
      return;
    }
    onOpenChange?.(false);
  };

  const fieldClass =
    "h-9 w-full rounded-[9px] border border-border bg-surface-1 px-2.5 text-[13px] text-foreground";

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-border/60">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("recordSale.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("recordSale.subtitle", {
              name: item?.name || t("excludeDialog.item"),
              available: maxQuantity,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid grid-cols-2 gap-3 py-1">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">
              {t("recordSale.quantity")}
            </span>
            <input
              type="number"
              min="1"
              max={maxQuantity}
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className={fieldClass}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">
              {t("recordSale.unitPrice", { currency })}
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className={fieldClass}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">
              {t("recordSale.soldAt")}
            </span>
            <input
              type="date"
              value={soldAt}
              onChange={(event) => setSoldAt(event.target.value)}
              className={fieldClass}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">
              {t("recordSale.platform")}
            </span>
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
              className={fieldClass}
            >
              <option value="steam">{t("recordSale.platformSteam")}</option>
              <option value="csfloat">CSFloat</option>
              <option value="skinbaron">SkinBaron</option>
              <option value="manual">{t("recordSale.platformOther")}</option>
            </select>
          </label>
        </div>

        {error ? (
          <Callout tone="danger" className="mt-1">
            <span className="flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </span>
          </Callout>
        ) : null}

        {shortfall > 0 ? (
          <Callout tone="warn" className="mt-1">
            {t("recordSale.partial", { count: shortfall })}
          </Callout>
        ) : null}

        <AlertDialogFooter>
          {shortfall > 0 ? (
            <AlertDialogCancel>{t("recordSale.acknowledge")}</AlertDialogCancel>
          ) : (
            <>
              <AlertDialogCancel disabled={isLoading}>
                {t("actions.cancel", { ns: "common" })}
              </AlertDialogCancel>
              <Button size="sm" onClick={() => void handleSubmit()} disabled={isLoading}>
                {isLoading ? t("recordSale.saving") : t("recordSale.submit")}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
