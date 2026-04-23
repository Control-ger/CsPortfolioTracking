import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Key, Eye, EyeOff, Lock, AlertCircle, Percent, Wallet, ArrowLeft } from "lucide-react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchFeeSettings, updateFeeSettings, fetchCsFloatApiKeyStatus, updateCsFloatApiKey } from "@/lib/apiClient";
import { encrypt, isEncryptionConfigured } from "@/lib/encryption";

const DEFAULT_FORM = {
  fxFeePercent: "0",
  sellerFeePercent: "2",
  withdrawalFeePercent: "2.5",
  depositFeePercent: "2.8",
  depositFeeFixedEur: "0.26",
};

function toInputValue(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return String(value);
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState("fees");
  const [form, setForm] = useState(DEFAULT_FORM);
  const [source, setSource] = useState("defaults");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // CSFloat API Key State
  const [apiKey, setApiKey] = useState("");
  const [apiKeyLoading, setApiKeyLoading] = useState(true);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState({ configured: false, lastFour: null });
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyError, setApiKeyError] = useState("");
  const [apiKeySuccess, setApiKeySuccess] = useState("");
  const [encryptionReady, setEncryptionReady] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoading(true);
        setApiKeyLoading(true);

        const [feeResponse, keyStatusResponse] = await Promise.all([
          fetchFeeSettings(),
          fetchCsFloatApiKeyStatus()
        ]);

        const feeData = feeResponse?.data || {};
        setForm({
          fxFeePercent: toInputValue(feeData.fxFeePercent, DEFAULT_FORM.fxFeePercent),
          sellerFeePercent: toInputValue(feeData.sellerFeePercent, DEFAULT_FORM.sellerFeePercent),
          withdrawalFeePercent: toInputValue(
            feeData.withdrawalFeePercent,
            DEFAULT_FORM.withdrawalFeePercent,
          ),
          depositFeePercent: toInputValue(feeData.depositFeePercent, DEFAULT_FORM.depositFeePercent),
          depositFeeFixedEur: toInputValue(
            feeData.depositFeeFixedEur,
            DEFAULT_FORM.depositFeeFixedEur,
          ),
        });
        setSource(feeData.source === "db" ? "db" : "defaults");

        const keyStatus = keyStatusResponse?.data || { configured: false, lastFour: null };
        setApiKeyStatus(keyStatus);

        setEncryptionReady(isEncryptionConfigured());
        setError("");
      } catch (loadError) {
        setError(loadError.message || "Settings konnten nicht geladen werden.");
      } finally {
        setLoading(false);
        setApiKeyLoading(false);
      }
    };

    void loadSettings();
  }, []);

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
    setSuccess("");
  };

  const handleApiKeyChange = (event) => {
    setApiKey(event.target.value);
    setApiKeyError("");
    setApiKeySuccess("");
  };

  const handleSaveApiKey = async () => {
    try {
      setApiKeySaving(true);
      setApiKeyError("");
      setApiKeySuccess("");

      if (!encryptionReady) {
        throw new Error('Verschluesselung nicht konfiguriert. Bitte ENCRYPTION_KEY in .env setzen (mindestens 32 Zeichen).');
      }

      if (!apiKey.trim() || apiKey.length < 10) {
        throw new Error('Bitte einen gueltigen CSFloat API Key eingeben (mindestens 10 Zeichen).');
      }

      const encryptedKey = await encrypt(apiKey.trim());
      const response = await updateCsFloatApiKey(encryptedKey);
      const result = response?.data || {};

      setApiKeyStatus({
        configured: true,
        lastFour: result.lastFour || apiKey.slice(-4)
      });
      setApiKey("");
      setShowApiKey(false);
      setApiKeySuccess(`CSFloat API Key gespeichert (endet auf ...${result.lastFour || apiKey.slice(-4)})`);
    } catch (saveError) {
      setApiKeyError(saveError.message || "API Key konnte nicht gespeichert werden.");
    } finally {
      setApiKeySaving(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");

      const payload = {
        fxFeePercent: Number(form.fxFeePercent),
        sellerFeePercent: Number(form.sellerFeePercent),
        withdrawalFeePercent: Number(form.withdrawalFeePercent),
        depositFeePercent: Number(form.depositFeePercent),
        depositFeeFixedEur: Number(form.depositFeeFixedEur),
      };

      const response = await updateFeeSettings(payload);
      const saved = response?.data || payload;

      setForm({
        fxFeePercent: toInputValue(saved.fxFeePercent, DEFAULT_FORM.fxFeePercent),
        sellerFeePercent: toInputValue(saved.sellerFeePercent, DEFAULT_FORM.sellerFeePercent),
        withdrawalFeePercent: toInputValue(
          saved.withdrawalFeePercent,
          DEFAULT_FORM.withdrawalFeePercent,
        ),
        depositFeePercent: toInputValue(saved.depositFeePercent, DEFAULT_FORM.depositFeePercent),
        depositFeeFixedEur: toInputValue(saved.depositFeeFixedEur, DEFAULT_FORM.depositFeeFixedEur),
      });
      setSource("db");
      setSuccess("Fee-Settings gespeichert.");
    } catch (saveError) {
      setError(saveError.message || "Fee-Settings konnten nicht gespeichert werden.");
      setSuccess("");
    } finally {
      setSaving(false);
    }
  };

  const renderFeesTab = () => {
    if (loading) {
      return (
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {[1, 2, 3, 4, 5].map((entry) => (
                <div key={entry} className={`space-y-2 ${entry === 5 ? "sm:col-span-2" : ""}`}>
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
            <Skeleton className="h-10 w-28" />
          </CardContent>
        </Card>
      );
    }

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Percent className="h-5 w-5" />
            <CardTitle>Gebuehren</CardTitle>
            <Badge variant="outline" className="ml-auto">{source === "db" ? "Aus DB" : "Standard"}</Badge>
          </div>
          <CardDescription>
            Konfiguriere die Gebuehren fuer Netto-ROI und Break-even Berechnungen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              {success}
            </div>
          )}

          {/* Trading Fees Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Trading Gebuehren</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="fxFeePercent">
                  FX Fee (%)
                </label>
                <Input
                  id="fxFeePercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.fxFeePercent}
                  onChange={handleChange("fxFeePercent")}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="sellerFeePercent">
                  Seller Fee (%)
                </label>
                <Input
                  id="sellerFeePercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.sellerFeePercent}
                  onChange={handleChange("sellerFeePercent")}
                  disabled={saving}
                />
              </div>
            </div>
          </div>

          {/* Deposit/Withdrawal Fees Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Ein-/Auszahlungsgebuehren</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="withdrawalFeePercent">
                  Withdrawal Fee (%)
                </label>
                <Input
                  id="withdrawalFeePercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.withdrawalFeePercent}
                  onChange={handleChange("withdrawalFeePercent")}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="depositFeePercent">
                  Deposit Fee (%)
                </label>
                <Input
                  id="depositFeePercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.depositFeePercent}
                  onChange={handleChange("depositFeePercent")}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="depositFeeFixedEur">
                  Deposit Fee (Fix EUR)
                </label>
                <Input
                  id="depositFeeFixedEur"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.depositFeeFixedEur}
                  onChange={handleChange("depositFeeFixedEur")}
                  disabled={saving}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 pt-2 border-t">
            <p className="text-xs text-muted-foreground max-w-md">
              Funding Mode wird pro Investment gesetzt und in der Netto-Berechnung beruecksichtigt.
            </p>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Speichert..." : "Speichern"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderApiKeyTab = () => {
    if (apiKeyLoading) {
      return (
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-32" />
          </CardContent>
        </Card>
      );
    }

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            <CardTitle>CSFloat API Key</CardTitle>
            {apiKeyStatus.configured && (
              <Badge variant="outline" className="ml-auto text-emerald-600 border-emerald-200">
                Konfiguriert
              </Badge>
            )}
          </div>
          <CardDescription>
            API Key fuer CSFloat Integration. Wird verschluesselt uebertragen und in .env gespeichert.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!encryptionReady && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                <span>Verschluesselung nicht konfiguriert. Bitte VITE_ENCRYPTION_KEY in .env setzen.</span>
              </div>
            </div>
          )}

          {apiKeyError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {apiKeyError}
            </div>
          )}
          {apiKeySuccess && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              {apiKeySuccess}
            </div>
          )}

          {/* Current Status */}
          {apiKeyStatus.configured && (
            <div className="flex items-center gap-3 p-3 rounded-lg ">
              <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <Lock className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-medium">API Key aktiv</p>
                <p className="text-xs text-muted-foreground">Endet auf ...{apiKeyStatus.lastFour}</p>
              </div>
            </div>
          )}

          {/* Input Section */}
          <div className="space-y-3">
            <label className="text-sm font-medium">
              {apiKeyStatus.configured ? "Neuen Key eingeben" : "API Key eingeben"}
            </label>
            <div className="relative">
              <Input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={handleApiKeyChange}
                placeholder={apiKeyStatus.configured ? "Zum Aendern neuen Key eingeben..." : "CSFloat API Key..."}
                disabled={apiKeySaving || !encryptionReady}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                disabled={apiKeySaving}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              AES-256-CBC Verschluesselung. Der Key wird nie unverschluesselt uebertragen.
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSaveApiKey}
              disabled={apiKeySaving || !encryptionReady || !apiKey.trim()}
            >
              {apiKeySaving ? "Speichert..." : apiKeyStatus.configured ? "Key Aktualisieren" : "Key Speichern"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:p-8 font-sans text-foreground">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button asChild variant="ghost" size="icon" className="shrink-0">
              <Link to="/">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Einstellungen</h1>
              <p className="text-sm text-muted-foreground">
                Gebuehren und API Konfiguration
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="fees" className="flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              <span>Gebuehren</span>
            </TabsTrigger>
            <TabsTrigger value="api" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              <span>API Keys</span>
              {!apiKeyStatus.configured && (
                <span className="ml-1 h-2 w-2 rounded-full bg-amber-500" />
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="fees" className="mt-4">
            {renderFeesTab()}
          </TabsContent>

          <TabsContent value="api" className="mt-4">
            {renderApiKeyTab()}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
