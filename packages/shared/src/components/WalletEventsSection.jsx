import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle } from "lucide-react";

import { Button } from "./ui/button";
import { Callout } from "./ui/callout.jsx";
import { StatusPill } from "./ui/status-pill";
import {
  GridTable,
  GridTableEmpty,
  GridTableHead,
  GridTableRow,
} from "./ui/grid-table";
import { useCurrency } from "../contexts/CurrencyContext";
import { getActiveIntlLocale } from "../lib/i18n/index.js";

const PLATFORMS = ["csfloat", "skinbaron", "steam"];
const COLUMNS = "110px 96px minmax(0,1fr) 110px 110px 40px";

function todayInputValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function formatDate(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleDateString(getActiveIntlLocale(), {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "–";
}

/**
 * Deposits and withdrawals per marketplace wallet.
 *
 * One form for both directions — the sign is a choice, not a second entity.
 * "Balance afterwards" is optional and sits here rather than in a flow of its
 * own: recording a deposit means reading the marketplace's transaction page,
 * and the balance is on that same screen. Asking for it later would be a second
 * visit for something available during the first.
 */
export function WalletEventsSection({ events = [], factors = {}, onRecord, onDelete }) {
  const { t } = useTranslation(["inventory", "common"]);
  const { currency, convertToUsd, formatPrice, ratesLoading } = useCurrency();

  const [platform, setPlatform] = useState("csfloat");
  const [direction, setDirection] = useState("deposit");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [balanceAfter, setBalanceAfter] = useState("");
  const [occurredAt, setOccurredAt] = useState(todayInputValue);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const parse = (value) => Number(String(value).replace(",", "."));
  const money = (usd) =>
    formatPrice(Number(usd || 0), { useUsd: true, buyPriceUsd: Number(usd || 0) });

  const sortedEvents = useMemo(
    () =>
      [...(Array.isArray(events) ? events : [])].sort((left, right) =>
        String(right.occurredAt || "").localeCompare(String(left.occurredAt || "")),
      ),
    [events],
  );

  const handleSubmit = async () => {
    const parsedAmount = amount.trim() === "" ? 0 : parse(amount);
    const parsedBalance = balanceAfter.trim() === "" ? null : parse(balanceAfter);

    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setError(t("wallet.errorAmount"));
      return;
    }
    // A zero amount is only meaningful as a reconciliation point, which needs a
    // balance to reconcile against — the store rejects it otherwise.
    if (parsedAmount === 0 && parsedBalance === null) {
      setError(t("wallet.errorZeroNeedsBalance"));
      return;
    }
    if (parsedBalance !== null && (!Number.isFinite(parsedBalance) || parsedBalance < 0)) {
      setError(t("wallet.errorBalance"));
      return;
    }

    // Amounts persist as USD, so a write before the live rate has arrived is
    // stored against the placeholder (USD 1.08) and read back at the real one —
    // the user types 500 and sees 464.55, as if the app lost their money. Worse
    // here than elsewhere: the factor is built from these numbers.
    if (ratesLoading) {
      setError(t("wallet.errorRatesLoading"));
      return;
    }

    setError("");
    setSaving(true);
    try {
      const signed = direction === "withdrawal" ? -Math.abs(parsedAmount) : Math.abs(parsedAmount);
      await onRecord?.({
        platform,
        amountUsd: convertToUsd(signed),
        // A withdrawal fee is already taken off the proceeds side, so only an
        // acquisition-side fee belongs here.
        feeUsd: direction === "deposit" && fee.trim() !== "" ? convertToUsd(parse(fee)) : 0,
        balanceAfterUsd: parsedBalance === null ? null : convertToUsd(parsedBalance),
        occurredAt: new Date(`${occurredAt}T12:00:00Z`).toISOString(),
      });
      setAmount("");
      setFee("");
      setBalanceAfter("");
    } catch (recordError) {
      // A write that fails silently is worse than one that fails loudly: the
      // form would clear as if it had worked and the factor would stay wrong
      // with nothing to explain it.
      console.warn("[wallet] record failed", recordError);
      setError(t("wallet.errorSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const fieldClass =
    "h-9 w-full rounded-[9px] border border-border bg-surface-1 px-2.5 text-[13px] text-foreground";
  const labelClass = "text-[11px] font-semibold text-muted-foreground";

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-bold">{t("wallet.title")}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{t("wallet.hint")}</p>
      </div>

      {/* One factor per marketplace: a deposit funds one wallet and never raises
          the cost of items bought elsewhere. */}
      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map((key) => {
          const state = factors[key];
          const factor = state?.factor;
          return (
            <div key={key} className="rounded-xl border border-border-soft px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {key}
              </p>
              <p className="mt-1 text-sm font-bold tabular-nums">
                {factor ? `×${factor.toFixed(4)}` : "×1.0000"}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {t("wallet.balance", { value: money(state?.balance || 0) })}
              </p>
              {state?.wentNegative ? (
                <StatusPill tone="warn" className="mt-1.5">
                  {t("wallet.missingDeposit")}
                </StatusPill>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t("wallet.platform")}</span>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={fieldClass}>
            {PLATFORMS.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t("wallet.direction")}</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value)} className={fieldClass}>
            <option value="deposit">{t("wallet.deposit")}</option>
            <option value="withdrawal">{t("wallet.withdrawal")}</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t("wallet.amount", { currency })}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={fieldClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t("wallet.fee", { currency })}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            disabled={direction === "withdrawal"}
            title={direction === "withdrawal" ? t("wallet.feeWithdrawalHint") : undefined}
            className={`${fieldClass} disabled:opacity-45`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t("wallet.balanceAfter", { currency })}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={balanceAfter}
            onChange={(e) => setBalanceAfter(e.target.value)}
            placeholder={t("wallet.optional")}
            className={fieldClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t("wallet.occurredAt")}</span>
          <input
            type="date"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className={fieldClass}
          />
        </label>
      </div>

      {error ? (
        <Callout tone="danger">
          <span className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            {error}
          </span>
        </Callout>
      ) : null}

      <Button size="sm" onClick={() => void handleSubmit()} disabled={saving || ratesLoading}>
        {saving ? t("wallet.saving") : t("wallet.submit")}
      </Button>

      <GridTable>
        <GridTableHead columns={COLUMNS}>
          <span>{t("wallet.platform")}</span>
          <span>{t("wallet.direction")}</span>
          <span className="text-right">{t("wallet.amountShort")}</span>
          <span className="text-right">{t("wallet.balanceShort")}</span>
          <span className="text-right">{t("wallet.occurredAt")}</span>
          <span />
        </GridTableHead>

        {sortedEvents.length === 0 ? (
          <GridTableEmpty>{t("wallet.empty")}</GridTableEmpty>
        ) : (
          sortedEvents.map((event) => {
            const isWithdrawal = Number(event.amountUsd) < 0;
            const isReconciliation = Number(event.amountUsd) === 0;
            return (
              <GridTableRow key={event.id} columns={COLUMNS}>
                <span className="truncate text-[12px] font-semibold uppercase">{event.platform}</span>
                <span className="text-[12px] text-muted-foreground">
                  {isReconciliation
                    ? t("wallet.reconciliation")
                    : isWithdrawal
                      ? t("wallet.withdrawal")
                      : t("wallet.deposit")}
                </span>
                <span
                  className={`text-right text-[13px] font-bold tabular-nums ${
                    isReconciliation ? "text-muted-foreground" : isWithdrawal ? "text-danger" : "text-success"
                  }`}
                >
                  {isReconciliation ? "–" : money(event.amountUsd)}
                  {Number(event.feeUsd) > 0 ? (
                    <span className="ml-1 font-semibold text-muted-foreground">
                      {t("wallet.feeSuffix", { value: money(event.feeUsd) })}
                    </span>
                  ) : null}
                </span>
                <span className="text-right text-[12px] tabular-nums text-muted-foreground">
                  {event.balanceAfterUsd === null || event.balanceAfterUsd === undefined
                    ? "–"
                    : money(event.balanceAfterUsd)}
                </span>
                <span className="text-right text-[12px] tabular-nums text-muted-foreground">
                  {formatDate(event.occurredAt)}
                </span>
                <button
                  type="button"
                  onClick={() => void onDelete?.(event.id)}
                  className="text-[12px] text-muted-foreground transition-colors hover:text-danger"
                  title={t("actions.delete", { ns: "common" })}
                >
                  ✕
                </button>
              </GridTableRow>
            );
          })
        )}
      </GridTable>
    </div>
  );
}
