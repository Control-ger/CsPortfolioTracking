import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import {
  AlertTriangle,
  Boxes,
  Info,
  Layers,
  Package,
  Search,
  TrendingUp,
} from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  EmptyState,
  FilterChip,
  FilterGroup,
  FilterScopeButton,
  FilterScopeIcon,
  FilterSidebar,
  FilterSortButton,
  GridTable,
  GridTableEmpty,
  GridTableFoot,
  GridTableHead,
  GridTableRow,
  Input,
  Inspector,
  InspectorBlock,
  InspectorEmpty,
  InspectorFooter,
  InspectorHeader,
  InspectorPrice,
  InspectorStat,
  ItemThumb,
  MetaRow,
  NativeSelect,
  Pagination,
  RoiMeter,
  ScrollArea,
  SectionLabel,
  SegmentedControl,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Separator,
  SettingsBanner,
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
  SettingsKeyInput,
  SettingsKeyRow,
  SettingsNote,
  SettingsRow,
  SettingsTile,
  Skeleton,
  Sparkline,
  StatusPill,
  Switch,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toneFill,
  TONES,
  toneText,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/index.js";
import { useTheme } from "../contexts/ThemeContext.jsx";
import { Abbr, AbbreviationTooltip } from "../components/AbbreviationTooltip.jsx";
import { FeedItem } from "../components/CsUpdatesFeed.jsx";
import { ItemListRow } from "../components/ItemListRow.jsx";
import { LayeredGroupIcon } from "../components/LayeredGroupIcon.jsx";
import {
  CardSkeleton,
  ChartSkeleton,
  PageHeaderSkeleton,
  StatsCardsSkeleton,
  TableSkeleton,
} from "../components/LoadingSkeletons.jsx";
import { MetricPairBlock, MetricPairInline } from "../components/MetricPair.jsx";
import { PortfolioChart } from "../components/PortfolioChart.jsx";
import { PortfolioCompositionChart } from "../components/PortfolioCompositionChart.jsx";
import { PortfolioHeaderCard } from "../components/PortfolioHeaderCard.jsx";
import { PriceSourceBadge } from "../components/PriceSourceBadge.jsx";
import { StatCard } from "../components/StatsCards.jsx";

/**
 * The design system's living catalogue.
 *
 * Its job is to make the library *visible*: a new view should start here, by
 * looking at what already exists, rather than by hand-rolling another tinted
 * box. It renders the real primitives against the real tokens, so it doubles as
 * the light/dark regression check — anything that breaks when the theme flips
 * breaks visibly on this page first.
 *
 * Deliberately not registered in the sidebar rail or the bottom navigation,
 * like `/wrapped`: it is a builder's tool reached by URL (`#/design`), not a
 * user-facing screen.
 */

const SPARKLINE_SAMPLE = [12, 14, 13.4, 16, 15.2, 19, 18.1, 22, 21, 26, 24.5, 29];

/** One labelled specimen. The label is the code you would write. */
function Specimen({ code, children, className = "" }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <code className="text-[10.5px] leading-tight text-muted-foreground">{code}</code>
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>{children}</div>
    </div>
  );
}

function Section({ id, title, note, children }) {
  return (
    <section id={id} className="scroll-mt-6 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-extrabold tracking-tight text-foreground">{title}</h2>
        {note ? (
          <p className="max-w-[80ch] text-[12px] leading-[1.55] text-pretty text-muted-foreground">
            {note}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-5 rounded-[14px] border border-border bg-card p-5">
        {children}
      </div>
    </section>
  );
}

/**
 * Bumps whenever the root element's class list changes — i.e. whenever the
 * theme actually lands in the DOM, no matter who changed it: this page's
 * control, the sidebar toggle, or the OS following the `system` mode.
 */
function useRootClassVersion() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((current) => current + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return version;
}

/**
 * A token swatch reads the *computed* value out of the DOM rather than repeating
 * the hex from index.css. A hardcoded copy would keep looking correct after
 * someone changed the token, which is the one failure a swatch must not have.
 */
function TokenSwatch({ token, label, classVersion }) {
  // Keyed on `classVersion`, not on the theme state, because ThemeProvider
  // writes the `dark` class in an effect — which runs *after* this component
  // renders. Keying on the state would read the computed value before the
  // class flipped and leave every readout one switch behind, permanently,
  // since a class change on its own triggers no re-render.
  const resolved = useMemo(
    () => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- classVersion is the invalidation key, not a value used here
    [token, classVersion],
  );

  return (
    <div className="flex min-w-[132px] flex-col gap-1.5">
      <span
        className="h-11 w-full rounded-[10px] border border-border"
        style={{ background: `var(${token})` }}
      />
      <span className="text-[11px] font-bold text-foreground">{label}</span>
      <code className="text-[10px] leading-tight text-muted-foreground">{token}</code>
      <code className="text-[9.5px] leading-tight text-muted-foreground/80">{resolved}</code>
    </div>
  );
}

const SURFACE_TOKENS = [
  ["--background", "background"],
  ["--card", "card"],
  ["--popover", "popover"],
  ["--muted", "muted"],
  ["--accent", "accent"],
  ["--primary", "primary"],
];

const STATUS_TOKENS = [
  ["--success", "success"],
  ["--warn", "warn"],
  ["--info", "info"],
  ["--destructive", "danger"],
];

const LINE_TOKENS = [
  ["--border-soft", "border-soft"],
  ["--border", "border"],
  ["--border-strong", "border-strong"],
];

const BUTTON_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
  "softSuccess",
  "softWarn",
  "softDanger",
];

const GRID_COLUMNS = "minmax(0,2fr) 90px 90px 70px";

const CHART_SAMPLE = SPARKLINE_SAMPLE.map((value, index) => ({
  day: `${index + 1}.`,
  wert: value,
}));

const CHART_CONFIG = { wert: { label: "Wert", color: "var(--chart-1)" } };

// Section order is the reading order of the page; the nav is generated from it
// so a new section cannot be added without also appearing in the jump list.
const SECTIONS = [
  ["tokens", "Tokens"],
  ["tone", "Tone"],
  ["actions", "Buttons"],
  ["feedback", "Status"],
  ["dialogs", "Dialoge"],
  ["input", "Eingabe"],
  ["navigation", "Navigation"],
  ["data", "Daten"],
  ["charts", "Charts"],
  ["containers", "Container"],
  ["settings", "Settings"],
  ["filter", "Filter-Rail"],
  ["inspector", "Inspector"],
  ["typography", "Typografie"],
  ["patterns", "Muster"],
];

// Fixtures for the composed components. Deliberately plain objects: a pattern
// that needs a live hook to render is a screen, not a building block.
// `count` feeds the Items tile; without it the chart correctly reports zero.
const COMPOSITION_DATA = [
  { name: "Fever Case", value: 412.5, count: 220 },
  { name: "Dreams & Nightmares Case", value: 308.2, count: 168 },
  { name: "Gallery Case", value: 236.9, count: 96 },
  { name: "★ Huntsman Knife | Gamma Doppler", value: 160.4, count: 1 },
  { name: "Kilowatt Case", value: 144.1, count: 74 },
  { name: "AWP | Containment Breach", value: 105.6, count: 12 },
];

const CHART_HISTORY = Array.from({ length: 30 }, (_, index) => {
  const day = new Date(Date.UTC(2026, 6, 1 + index));
  const drift = Math.sin(index / 4) * 40 + index * 6;
  return {
    id: index,
    date: day.toISOString(),
    priceUsd: 1200 + drift,
    growthPercent: (drift / 1200) * 100,
  };
});

const LIST_ROW_ITEM = {
  name: "AK-47 | Redline (Field-Tested)",
  currentPriceUsd: 24.1,
  roi: 18.4,
  changeLabel: "30 Tage",
  trend: "up",
  buyOrderCount: 3,
  buyOrderBestPriceUsd: 21.5,
};

const GROUP_VISUALS = [
  { id: "a", name: "Fever Case" },
  { id: "b", name: "Kilowatt Case" },
];

// Two ratings, because the tone a feed entry renders in is derived from the AI
// impact level — the mapping is only checkable side by side.
const FEED_UPDATE = {
  id: "demo-update",
  title: "Counter-Strike 2 Update (SteamDB Build 24537688)",
  summary: "Kleinere Fehlerbehebungen und Karten-Anpassungen.",
  source: "SteamDB RSS",
  publishedAt: new Date(Date.UTC(2026, 7, 3, 21, 18)).toISOString(),
  url: "https://example.invalid/update",
  tags: ["build:24537688", "impact:none"],
  aiRatingStatus: "rated",
  aiImpactLevel: "none",
  aiModel: "gemini-3.1-flash-lite",
  aiRecommendedAction: "HOLD bestehende Bestände, keine neuen Käufe nötig.",
  aiReasoning:
    "Das Update enthält keine spielverändernden Inhalte oder wirtschaftsrelevanten Änderungen.",
};

const FEED_BAN_WAVE = {
  id: "demo-banwave",
  title: "Ban-Welle erkannt (250 % des Medians)",
  summary: "Deutlich erhöhte VAC-Bans, durch die Zweitquelle bestätigt.",
  source: "ban_wave_detected",
  publishedAt: new Date(Date.UTC(2026, 7, 5, 6, 0)).toISOString(),
  tags: ["ban-wave", "impact:high"],
  aiRatingStatus: "rated",
  aiImpactLevel: "high",
  aiRecommendedAction: "Relevante Positionen kurzfristig prüfen.",
  aiReasoning: "Ban-Wellen entziehen dem Markt kurzfristig Angebot und Nachfrage zugleich.",
};

export function DesignSystemPage() {
  // The app's own theme state, not a copy of it. An earlier version held local
  // state and toggled the `dark` class directly, which broke in two ways:
  // switching the theme from the sidebar left this control showing the old
  // value, and the swatch readouts — memoised against that stale value — then
  // printed the dark tokens next to a light page. A swatch that lies about the
  // token is the one failure it must not have.
  const { themeMode, setThemeMode } = useTheme();
  const classVersion = useRootClassVersion();
  const [switchOn, setSwitchOn] = useState(true);
  const [segment, setSegment] = useState("alle");
  const [page, setPage] = useState(3);
  const [tab, setTab] = useState("uebersicht");
  const [source, setSource] = useState("csfloat");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(true);
  const [scope, setScope] = useState("investments");
  const [tile, setTile] = useState("dunkel");
  const [chips, setChips] = useState(["Kisten"]);

  const toggleChip = (name) =>
    setChips((current) =>
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name],
    );

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Design System</SectionLabel>
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-foreground">
            Bausteine
          </h1>
          <p className="max-w-[70ch] text-[12.5px] leading-[1.55] text-pretty text-muted-foreground">
            Alles, woraus eine neue Ansicht gebaut wird. Import über{" "}
            <code className="text-foreground">@shared/components/ui</code>. Farbe kommt
            ausschließlich aus Tokens — keine <code className="text-foreground">slate-400</code>,
            keine <code className="text-foreground">emerald-500</code>.
          </p>
        </div>
        {/* Same three modes as the Darstellung tile row in Einstellungen, and
            the same store — switching here is a real app-wide theme change, so
            the whole page (and every `dark:` variant in it) flips for real. */}
        <SegmentedControl
          items={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          value={themeMode}
          onChange={setThemeMode}
        />
      </header>

      {/* Plain anchors rather than scroll handlers: the page lives inside the
          app's <main> scroll container, and `scroll-mt-6` on each section keeps
          the heading clear of the top edge. */}
      <nav className="sticky top-0 z-10 -mx-5 flex flex-wrap gap-1 border-b border-border-soft bg-background/85 px-5 py-2.5 backdrop-blur">
        {SECTIONS.map(([id, label]) => (
          <a
            key={id}
            href={`#/design#${id}`}
            onClick={(event) => {
              event.preventDefault();
              document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="rounded-[8px] px-2 py-1 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            {label}
          </a>
        ))}
      </nav>

      <Section
        id="tokens"
        title="Tokens"
        note="Die Quelle steht in apps/web/src/index.css. Jeder Wert existiert zweimal — hell und dunkel — und flippt mit der dark-Klasse am Wurzelelement. Deshalb braucht getokenter Code fast nie eine dark:-Variante."
      >
        <Specimen code="Flächen">
          {SURFACE_TOKENS.map(([token, label]) => (
            <TokenSwatch key={token} token={token} label={label} classVersion={classVersion} />
          ))}
        </Specimen>
        <Separator />
        <Specimen code="Status — Bedeutung, nicht Farbe">
          {STATUS_TOKENS.map(([token, label]) => (
            <TokenSwatch key={token} token={token} label={label} classVersion={classVersion} />
          ))}
        </Specimen>
        <Separator />
        <Specimen code="Linien — je nach Gewicht der Trennung">
          {LINE_TOKENS.map(([token, label]) => (
            <TokenSwatch key={token} token={token} label={label} classVersion={classVersion} />
          ))}
        </Specimen>
      </Section>

      <Section
        id="tone"
        title="Tone-Vokabular"
        note="Ein Tone beschreibt, was ein Wert bedeutet. Drei Rollen, die nicht vertauscht werden dürfen: TONE_TEXT färbt Text, TONE_FILL füllt Punkte und Balken, TONE_TINT ist die Callout-Box. Ein Fill als Tint ergibt einen knallgrünen Kasten."
      >
        <Specimen code="toneText(tone)">
          {TONES.map((tone) => (
            <span key={tone} className={`text-[13px] font-bold ${toneText(tone)}`}>
              {tone}
            </span>
          ))}
        </Specimen>
        <Specimen code="toneFill(tone) — Punkte, Balken, Meter">
          {TONES.map((tone) => (
            <span key={tone} className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-full ${toneFill(tone)}`} aria-hidden />
              <span className="text-[11px] text-muted-foreground">{tone}</span>
            </span>
          ))}
        </Specimen>
        <Separator />
        <Specimen code='<StatusPill tone="…" dot />'>
          {["success", "warn", "info", "danger", "muted"].map((tone) => (
            <StatusPill key={tone} tone={tone} dot>
              {tone}
            </StatusPill>
          ))}
        </Specimen>
        <Specimen code='<StatusPill tone="…" onClick={…} /> — klickbar, rendert als <button>'>
          <StatusPill tone="warn" onClick={() => {}}>
            80 ohne Einkaufspreis
          </StatusPill>
          <StatusPill tone="muted">0 neue Items</StatusPill>
        </Specimen>
      </Section>

      <Section
        id="actions"
        title="Buttons"
        note="Die Soft-Varianten sind für zustimmende oder warnende Zweitaktionen — sie lesen sich neben dem soliden default als nachgeordnet, ohne dass jemand eine Tint-Klasse von Hand baut."
      >
        <Specimen code='<Button variant="…" />'>
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} size="sm">
              {variant}
            </Button>
          ))}
        </Specimen>
        <Separator />
        <Specimen code='<Button size="…" />'>
          <Button size="sm">sm</Button>
          <Button size="default">default</Button>
          <Button size="lg">lg</Button>
          <Button size="icon" aria-label="Suche">
            <Search />
          </Button>
        </Specimen>
        <Specimen code="disabled">
          <Button disabled>default</Button>
          <Button variant="outline" disabled>
            outline
          </Button>
        </Specimen>
      </Section>

      <Section
        id="feedback"
        title="Status & Rückmeldung"
        note="Callout ist der Block mit Fließtext, StatusPill das Inline-Label an einem Objekt, Badge die neutrale Zählmarke. Callout ersetzt das früher überall handgebaute border-X/30 bg-X/10."
      >
        <Specimen code="<Callout tone='…' icon title>" className="flex-col items-stretch">
          <Callout tone="info" icon={<Info className="size-4" />} title="Preise aus dem Cache">
            Passive Ansichten holen nie live nach. Der Cron aktualisiert stündlich.
          </Callout>
          <Callout tone="warn" icon={<AlertTriangle className="size-4" />}>
            Preise sind älter als 24 Stunden.
          </Callout>
          <Callout tone="danger" title="Sync fehlgeschlagen">
            Die Cloudflare-Access-Sitzung ist abgelaufen.
          </Callout>
          <Callout tone="success">Import abgeschlossen — 42 Positionen übernommen.</Callout>
        </Specimen>
        <Separator />
        <Specimen code="<Badge variant='…' />">
          <Badge>default</Badge>
          <Badge variant="secondary">secondary</Badge>
          <Badge variant="outline">outline</Badge>
          <Badge variant="destructive">destructive</Badge>
        </Specimen>
        <Separator />
        <Specimen code="<Skeleton /> — Ladezustand, nie eine falsche Null" className="flex-col items-stretch">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-6 w-64" />
        </Specimen>
        <Separator />
        <Specimen code="<EmptyState />" className="flex-col items-stretch">
          <EmptyState
            icon={<Package className="size-6" />}
            title="Noch keine Gruppen"
            description="Lege in der Verwaltung deine erste Investment-Gruppe an und weise Cluster oder einzelne Positionen zu."
            action={
              <Button size="sm" variant="outline">
                Zur Verwaltung
              </Button>
            }
          />
        </Specimen>
      </Section>

      <Section
        id="dialogs"
        title="Dialoge"
        note="AlertDialog ist die Bestätigung, die den Fluss unterbricht — nur für Aktionen, die man nicht zurücknehmen kann. Alert ist der ältere shadcn-Block; für neue Arbeit ist Callout die richtige Wahl."
      >
        <Specimen code="<AlertDialog /> — irreversible Aktion">
          <Button variant="softDanger" size="sm" onClick={() => setDialogOpen(true)}>
            Position löschen
          </Button>
          <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Position wirklich löschen?</AlertDialogTitle>
                <AlertDialogDescription>
                  Die Position und ihre Kaufhistorie werden entfernt. Das lässt sich nicht
                  rückgängig machen.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction>Löschen</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Specimen>
        <Separator />
        <Specimen code="<Alert /> — Altbestand, für Neues Callout nehmen" className="flex-col items-stretch">
          <Alert>
            <AlertTitle>Hinweis</AlertTitle>
            <AlertDescription>Der Preis-Cron lief zuletzt vor 18 Minuten.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>Fehler</AlertTitle>
            <AlertDescription>Upstream nicht erreichbar.</AlertDescription>
          </Alert>
        </Specimen>
      </Section>

      <Section
        id="input"
        title="Eingabe"
        note="NativeSelect für dichte Zeilen und mobil — der System-Picker ist dort schneller und barrierefreier als ein nachgebautes Menü."
      >
        <Specimen code="<Input />" className="flex-col items-stretch">
          <Input placeholder="Item suchen..." />
          <Input placeholder="deaktiviert" disabled />
        </Specimen>
        <Specimen code="<NativeSelect />">
          <NativeSelect defaultValue="csfloat">
            <option value="csfloat">CSFloat</option>
            <option value="steam">Steam</option>
            <option value="skinbaron">SkinBaron</option>
          </NativeSelect>
        </Specimen>
        <Specimen code="<Switch />">
          <Switch checked={switchOn} onCheckedChange={setSwitchOn} />
          <span className="text-[12px] text-muted-foreground">
            {switchOn ? "aktiv" : "inaktiv"}
          </span>
        </Specimen>
        <Specimen code="<SegmentedControl />">
          <SegmentedControl
            items={[
              { value: "alle", label: "Alle" },
              { value: "invest", label: "Investments" },
              { value: "inventar", label: "Inventar" },
            ]}
            value={segment}
            onChange={setSegment}
          />
        </Specimen>
      </Section>

      <Section
        id="navigation"
        title="Navigation & Overlays"
        note="Tabs für gleichrangige Ansichten derselben Sache, Accordion für optionales Detail, DropdownMenu für Aktionen an einem Objekt. Select ist das Radix-Menü — auf dichten Zeilen und mobil stattdessen NativeSelect."
      >
        <Specimen code="<Tabs />" className="flex-col items-stretch">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="uebersicht">Übersicht</TabsTrigger>
              <TabsTrigger value="matching">Matching</TabsTrigger>
              <TabsTrigger value="preise">Preise</TabsTrigger>
            </TabsList>
            <TabsContent value="uebersicht" className="text-[12px] text-muted-foreground">
              Inhalt der Übersicht.
            </TabsContent>
            <TabsContent value="matching" className="text-[12px] text-muted-foreground">
              Inhalt des Matchings.
            </TabsContent>
            <TabsContent value="preise" className="text-[12px] text-muted-foreground">
              Inhalt der Preise.
            </TabsContent>
          </Tabs>
        </Specimen>
        <Separator />
        <Specimen code="<Accordion type='single' collapsible />" className="flex-col items-stretch">
          <Accordion type="single" collapsible>
            <AccordionItem value="a">
              <AccordionTrigger>Wie wird der ROI berechnet?</AccordionTrigger>
              <AccordionContent className="text-[12px] text-muted-foreground">
                Livewert gegen Einkaufspreis, Gebühren nach den Einstellungen abgezogen.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="b">
              <AccordionTrigger>Woher kommen die Preise?</AccordionTrigger>
              <AccordionContent className="text-[12px] text-muted-foreground">
                Aus dem Cache, den der Cron stündlich füllt. Passive Ansichten holen nie live nach.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Specimen>
        <Separator />
        <Specimen code="<DropdownMenu /> · <Select /> · <Tooltip />">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Aktionen
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Position</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem>
                  Bearbeiten <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuCheckboxItem checked>
                  Aus Kennzahlen ausblenden
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Bucket</DropdownMenuLabel>
              <DropdownMenuRadioGroup value="investments">
                <DropdownMenuRadioItem value="investments">Investments</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="inventar">Inventar</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Verschieben nach</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>Langfrist-Kisten</DropdownMenuItem>
                  <DropdownMenuItem>Messer</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Löschen</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Preisquelle" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Marktplätze</SelectLabel>
                <SelectItem value="csfloat">CSFloat</SelectItem>
                <SelectItem value="skinbaron">SkinBaron</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Valve</SelectLabel>
                <SelectItem value="steam">Steam Market</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm">
                  Tooltip hover
                </Button>
              </TooltipTrigger>
              <TooltipContent>Preis aus dem Cache, 18 Minuten alt.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Specimen>
        <Separator />
        <Specimen code="<ScrollArea /> — begrenzte Höhe mit eigenem Balken" className="flex-col items-stretch">
          <ScrollArea className="h-32 w-full rounded-[10px] border border-border p-3">
            <div className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
              {Array.from({ length: 14 }, (_, i) => (
                <span key={i}>Zeile {i + 1}</span>
              ))}
            </div>
          </ScrollArea>
        </Specimen>
      </Section>

      <Section
        id="data"
        title="Datenanzeige"
        note="Zwei Tabellensysteme, und die Wahl ist nicht kosmetisch: GridTable ist die CSS-Grid-Tabelle für die dichten Portfolio-Listen (Spalten bleiben über einen virtualisierten Body ausgerichtet, Zeilen sind vollflächig selektierbar). Table ist echtes <table>-Markup für kleine statische Tabellen in Modals."
      >
        <Specimen code="<GridTable /> — dichte Liste" className="flex-col items-stretch">
          <GridTable>
            <GridTableHead columns={GRID_COLUMNS}>
              <span>Item</span>
              <span className="text-right">Preis</span>
              <span className="text-right">Verlauf</span>
              <span className="text-right">ROI</span>
            </GridTableHead>
            {[
              { name: "AK-47 | Redline (FT)", price: "24,10 €", roi: 18.4 },
              { name: "Dreams & Nightmares Case", price: "1,84 €", roi: -6.2 },
            ].map((row) => (
              <GridTableRow key={row.name} columns={GRID_COLUMNS}>
                <span className="flex min-w-0 items-center gap-2">
                  <ItemThumb size="sm" alt="" />
                  <span className="truncate">{row.name}</span>
                </span>
                <span className="text-right tabular-nums">{row.price}</span>
                <span className="flex justify-end">
                  <Sparkline values={SPARKLINE_SAMPLE} />
                </span>
                <span className="flex items-center justify-end gap-1.5">
                  <RoiMeter value={row.roi} />
                </span>
              </GridTableRow>
            ))}
            <GridTableFoot>
              <span className="text-[11.5px] text-muted-foreground">2 von 128 Positionen</span>
            </GridTableFoot>
          </GridTable>
        </Specimen>
        <Specimen code="<GridTableEmpty /> — Leerzustand im Tabellen-Slot" className="flex-col items-stretch">
          <GridTable>
            <GridTableHead columns={GRID_COLUMNS}>
              <span>Item</span>
              <span className="text-right">Preis</span>
              <span className="text-right">Verlauf</span>
              <span className="text-right">ROI</span>
            </GridTableHead>
            <GridTableEmpty>Keine Positionen für diese Filter.</GridTableEmpty>
          </GridTable>
        </Specimen>
        <Separator />
        <Specimen code="<Table /> — kleine statische Tabelle" className="flex-col items-stretch">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Preis</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead>Menge</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="tabular-nums">22,40 €</TableCell>
                <TableCell className="tabular-nums">3</TableCell>
                <TableCell className="tabular-nums">7</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="tabular-nums">21,90 €</TableCell>
                <TableCell className="tabular-nums">1</TableCell>
                <TableCell className="tabular-nums">2</TableCell>
              </TableRow>
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Summe</TableCell>
                <TableCell className="tabular-nums">4</TableCell>
                <TableCell className="tabular-nums">9</TableCell>
              </TableRow>
            </TableFooter>
            <TableCaption>Offene Buy-Orders für dieses Item.</TableCaption>
          </Table>
        </Specimen>
        <Separator />
        <Specimen code="<MetaRow /> · <Sparkline /> · <RoiMeter /> · <ItemThumb />" className="flex-col items-stretch">
          <div className="max-w-sm text-[12px]">
            <MetaRow label="Einkaufspreis" value="19,80 €" />
            <MetaRow label="Gewinn" value="+4,30 €" tone="success" />
            <MetaRow label="Preisalter" value="26 h" tone="warn" />
          </div>
          <div className="flex items-center gap-4">
            <Sparkline values={SPARKLINE_SAMPLE} />
            <RoiMeter value={42} />
            <RoiMeter value={-31} />
            <ItemThumb size="sm" alt="" />
            <ItemThumb size="md" alt="" />
            <ItemThumb size="lg" alt="" />
          </div>
        </Specimen>
        <Separator />
        <Specimen code="<Pagination />">
          <Pagination page={page} pageCount={12} onPageChange={setPage} />
        </Specimen>
      </Section>

      <Section
        id="charts"
        title="Charts"
        note="ChartContainer setzt Recharts auf die Tokens (Achsen, Gitter, Cursor) und stellt die config bereit, aus der Tooltip und Legende ihre Labels ziehen. Chart-Marken dürfen nie --steam-shell-color-* verwenden: die tragen eine eingebackene Alpha von 0.11-0.20 und rendern bei ~15 % Deckkraft — das ist der berüchtigte leere Donut. Dafür gibt es die opaken Geschwister aus steamChartPalette.js."
      >
        <Specimen code="<ChartContainer config={…}>" className="flex-col items-stretch">
          <ChartContainer config={CHART_CONFIG} className="aspect-[3/1] w-full">
            <AreaChart data={CHART_SAMPLE}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                dataKey="wert"
                type="monotone"
                stroke="var(--color-wert)"
                fill="var(--color-wert)"
                fillOpacity={0.18}
              />
            </AreaChart>
          </ChartContainer>
        </Specimen>
      </Section>

      <Section
        id="containers"
        title="Container"
        note="Card ist die generische Fläche. Einstellungen benutzen stattdessen die Settings*-Familie: ein Settings-Block ist eine geklippte Folge vollflächiger Zeilen, keine gepolsterte Card. Die beiden zu mischen ist genau das, was die alten Settings-Screens hat auseinanderlaufen lassen."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Card</CardTitle>
              <CardDescription>Generische Fläche für Dashboard-Panels.</CardDescription>
            </CardHeader>
            <CardContent className="text-[12px] text-muted-foreground">
              Inhalt mit eigener Polsterung.
            </CardContent>
          </Card>

          <SettingsCard>
            <SettingsCardHeader
              title="SettingsCard"
              description="Kopf mit Regel, danach vollflächige Zeilen."
              action={<StatusPill tone="success" dot>aktiv</StatusPill>}
            />
            {/* Rows sit directly in the card, not inside SettingsCardBody —
                they are full-bleed and carry their own divider. The padded
                body is for cards holding tiles or a form grid instead. */}
            <SettingsRow title="Anzeigewährung" description="Persistiert serverseitig.">
              <NativeSelect defaultValue="eur" className="w-28">
                <option value="eur">EUR</option>
                <option value="usd">USD</option>
              </NativeSelect>
            </SettingsRow>
            <SettingsRow title="Automatisch synchronisieren">
              <Switch checked={switchOn} onCheckedChange={setSwitchOn} />
            </SettingsRow>
            <SettingsCardBody>
              <SettingsNote>Änderungen wirken sofort.</SettingsNote>
            </SettingsCardBody>
          </SettingsCard>
        </div>
        <Specimen code="<CardFooter /> — Aktionsleiste am Fuß einer Card" className="flex-col items-stretch">
          <Card>
            <CardHeader>
              <CardTitle>Mit Fuß</CardTitle>
            </CardHeader>
            <CardContent className="text-[12px] text-muted-foreground">
              Inhalt über der Aktionsleiste.
            </CardContent>
            <CardFooter className="gap-2">
              <Button size="sm">Speichern</Button>
              <Button size="sm" variant="ghost">
                Verwerfen
              </Button>
            </CardFooter>
          </Card>
        </Specimen>
      </Section>

      <Section
        id="settings"
        title="Settings-Bausteine"
        note="Die restlichen Teile der Settings-Familie. SettingsTile ist die auswählbare Option (Theme, Fenster-Buttons, Preisquelle), SettingsKeyRow die Zugangsdaten-Zeile mit fixer 170px-Namensspalte, damit gestapelte Zeilen als eine Tabelle lesen."
      >
        <Specimen code="<SettingsTile active swatch hint />" className="flex-col items-stretch">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["system", "System", "Folgt dem Betriebssystem", "linear-gradient(90deg,#f4f4f5 50%,#18181b 50%)"],
              ["hell", "Hell", "Immer helles Design", "#f4f4f5"],
              ["dunkel", "Dunkel", "Immer dunkles Design", "#18181b"],
            ].map(([value, label, hint, swatch]) => (
              <SettingsTile
                key={value}
                active={tile === value}
                label={label}
                hint={hint}
                swatch={swatch}
                onClick={() => setTile(value)}
              />
            ))}
          </div>
        </Specimen>
        <Separator />
        <Specimen code="<SettingsBanner /> · <SettingsKeyRow /> · <SettingsKeyInput />" className="flex-col items-stretch">
          <SettingsCard>
            <SettingsCardHeader title="Verbindungen" description="API-Keys und Server." />
            <SettingsBanner tone="info" icon={<Info className="size-4 text-info" />}>
              Keys liegen ausschließlich im passwortgeschützten Secret Vault — nie in der
              Datenbank und nie auf dem Server.
            </SettingsBanner>
            <SettingsKeyRow name="CSFloat" state="hinterlegt" stateTone="success">
              <SettingsKeyInput defaultValue="••••••••••••••••" readOnly />
            </SettingsKeyRow>
            <SettingsKeyRow name="SkinBaron" state="fehlt" stateTone="warn" divider={false}>
              <SettingsKeyInput placeholder="API Key..." />
            </SettingsKeyRow>
          </SettingsCard>
        </Specimen>
      </Section>

      <Section
        id="filter"
        title="Filter-Rail"
        note="Die linke Spalte der Inventar- und Watchlist-Ansicht. Bewusst ohne runde Controls: eine Pille wäre hier die einzige und läse sich als andere Art von Ding. Eingeklappt ersetzen Icons die Labels — die Bereiche heißen „Investments“ und „Inventar“ und teilen sich nicht nur den Anfangsbuchstaben, sondern die erste Silbe."
      >
        <div className="flex gap-4">
          <FilterSidebar
            open={filterOpen}
            onToggle={() => setFilterOpen((value) => !value)}
            className="!flex rounded-[12px] border border-border"
            collapsed={
              <div className="flex flex-col gap-1">
                <FilterScopeIcon
                  active={scope === "investments"}
                  label="Investments"
                  icon={<Layers className="size-4" />}
                  onClick={() => setScope("investments")}
                />
                <FilterScopeIcon
                  active={scope === "inventar"}
                  label="Inventar"
                  icon={<Boxes className="size-4" />}
                  onClick={() => setScope("inventar")}
                />
              </div>
            }
          >
            <FilterGroup label="Bereich">
              <FilterScopeButton
                active={scope === "investments"}
                label="Investments"
                count={128}
                onClick={() => setScope("investments")}
              />
              <FilterScopeButton
                active={scope === "inventar"}
                label="Inventar"
                count={4013}
                onClick={() => setScope("inventar")}
              />
              <FilterScopeButton label="Verkauft" soon />
            </FilterGroup>
            <FilterGroup label="Kategorie">
              <div className="flex flex-wrap gap-1">
                {["Kisten", "Messer", "Handschuhe", "Souvenir"].map((name) => (
                  <FilterChip
                    key={name}
                    active={chips.includes(name)}
                    onClick={() => toggleChip(name)}
                  >
                    {name}
                  </FilterChip>
                ))}
              </div>
            </FilterGroup>
            <FilterGroup label="Sortierung">
              <FilterSortButton active direction="desc">
                Wert
              </FilterSortButton>
              <FilterSortButton>Name</FilterSortButton>
              <FilterSortButton soon>Kaufdatum</FilterSortButton>
            </FilterGroup>
          </FilterSidebar>
          <p className="self-start pt-2 text-[12px] text-muted-foreground">
            Der Umschalt-Pfeil oben in der Rail klappt sie ein — dann greift der
            <code className="mx-1 text-foreground">collapsed</code>-Slot mit den Icon-Buttons.
          </p>
        </div>
      </Section>

      <Section
        id="inspector"
        title="Inspector"
        note="Die rechte Detailspalte: eine Card, die durch Haarlinien in vollflächige Bänder geschnitten ist — kein Stapel gepolsterter Unter-Cards. Inventar und Watchlist teilen sie sich, damit die Detailansicht nicht in zwei Behandlungen auseinanderläuft."
      >
        <div className="max-w-[380px]">
          <InspectorEmpty>Wähle links eine Position, um Details zu sehen.</InspectorEmpty>
        </div>
        <div className="max-w-[380px]">
          <Inspector>
            <InspectorHeader
              thumb={<ItemThumb size="md" alt="" />}
              title="AK-47 | Redline"
              meta="Field-Tested · 2 Stück"
              badge={<StatusPill tone="info">CSFloat</StatusPill>}
            />
            <InspectorPrice value="24,10 €" delta="+8,2 %" tone="success" />
            <InspectorBlock label="Preisverlauf" aside="Buy-Order 21,50 €">
              <div className="pt-2">
                <Sparkline values={SPARKLINE_SAMPLE} width={320} height={54} />
              </div>
            </InspectorBlock>
            <InspectorStat label="Einkaufspreis" value="19,80 €" />
            <InspectorStat label="Gewinn" value="+4,30 €" tone="success" />
            <InspectorStat label="Preisalter" value="26 h" tone="warn" />
            <InspectorFooter>
              <Button size="sm" variant="outline">
                Bearbeiten
              </Button>
              <Button size="sm" variant="softDanger">
                Ausschließen
              </Button>
            </InspectorFooter>
          </Inspector>
        </div>
      </Section>

      <Section
        id="typography"
        title="Typografie"
        note="Zahlen stehen immer tabular-nums, damit gestapelte Beträge auf der Dezimalstelle fluchten. SectionLabel ist die Mikro-Überschrift über jedem gruppierten Block."
      >
        <Specimen code="SectionLabel · Überschriften · Zahlen" className="flex-col items-start">
          <SectionLabel>Einkaufspreise je Position</SectionLabel>
          <p className="text-[22px] font-extrabold tracking-[-0.02em] text-foreground">
            Seitentitel
          </p>
          <p className="text-[15px] font-extrabold text-foreground">Abschnitt</p>
          <p className="text-[12.5px] text-muted-foreground">
            Fließtext in gedämpfter Farbe für alles Erklärende.
          </p>
          <p className="flex items-center gap-2 text-[28px] font-extrabold tabular-nums tracking-[-0.03em] text-foreground">
            1.284,60 €
            <span className="flex items-center gap-1 text-[13px] font-bold text-success">
              <TrendingUp className="size-4" /> +8,2 %
            </span>
          </p>
        </Specimen>
      </Section>

      <Section
        id="patterns"
        title="Muster"
        note="Fachliche Bausteine, aus den Primitives zusammengesetzt. Sie stehen hier, weil sie sich aus einfachen Props darstellen lassen — mit erfundenen Daten, nicht mit deinem Portfolio. Ganze Bildschirmabschnitte, die ihre Daten selbst über Hooks holen (Verwaltung, Watchlist, Inventar, Suche), fehlen hier bewusst: sie sind keine Bausteine, du würdest sie in einer neuen Ansicht nie einsetzen."
      >
        <Specimen code="<StatCard /> — die KPI-Kacheln des Dashboards" className="flex-col items-stretch">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Portfolio Wert (live)" value="1.738,97 €" />
            <StatCard title="Gesamt Zuwachs" value="-404,59 €" subValue="-16.92 % | ROI gesamt" isPositive={false} />
            <StatCard title="Items im Bestand" value="4013 Stueck" />
            <StatCard title="Ladezustand" isLoading />
          </div>
        </Specimen>
        <Separator />
        <Specimen code="<PortfolioHeaderCard />" className="flex-col items-stretch">
          <PortfolioHeaderCard
            totalValue={1738.97}
            totalRoiPercent={-16.92}
            totalQuantity={4013}
            liveItemsCount={67}
            freshestDataAgeSeconds={120}
            oldestDataAgeSeconds={1080}
          />
        </Specimen>
        <Separator />
        <Specimen code="<PortfolioCompositionChart /> — der Donut" className="flex-col items-stretch">
          {/* valuesAreUsd={false}: these fixtures are already in the display
              currency, so they must not run through the USD conversion. */}
          <PortfolioCompositionChart data={COMPOSITION_DATA} valuesAreUsd={false} />
        </Specimen>
        <Separator />
        <Specimen code="<PortfolioChart />" className="flex-col items-stretch">
          <PortfolioChart history={CHART_HISTORY} title="Portfolio Entwicklung" />
        </Specimen>
        <Separator />
        <Specimen code="<FeedItem /> — Eintrag im CS-Updates-Feed. Der Ton kommt aus der KI-Impact-Bewertung." className="flex-col items-stretch">
          <Accordion type="single" collapsible className="space-y-2.5">
            <FeedItem item={FEED_UPDATE} isOpen={false} isFresh={false} compact={false} />
            <FeedItem item={FEED_BAN_WAVE} isOpen={false} isFresh compact={false} />
          </Accordion>
        </Specimen>
        <Separator />
        <Specimen code="<ItemListRow /> · <LayeredGroupIcon /> · <PriceSourceBadge />" className="flex-col items-stretch">
          <ItemListRow item={LIST_ROW_ITEM} onClick={() => {}} />
          <div className="flex items-center gap-5 pt-1">
            <LayeredGroupIcon visuals={GROUP_VISUALS} fallbackLabel="Langfrist" size="md" />
            <LayeredGroupIcon visuals={GROUP_VISUALS} fallbackLabel="Langfrist" size="sm" />
            <LayeredGroupIcon visuals={[]} fallbackLabel="Leer" />
            <PriceSourceBadge priceSource="csfloat" />
            <PriceSourceBadge priceSource="steam" />
          </div>
        </Specimen>
        <Separator />
        <Specimen code="<MetricPairBlock /> · <MetricPairInline /> — Brutto/Netto nach Gebühren">
          <MetricPairBlock
            title="Verkaufserlös"
            grossValue="24,10 €"
            netValue="20,49 €"
            note="nach CSFloat-Gebühren"
            className="w-52"
          />
          <MetricPairInline grossValue="24,10 €" netValue="20,49 €" />
        </Specimen>
        <Separator />
        <Specimen code="<Abbr /> · <AbbreviationTooltip /> — Fachbegriffe erklären sich beim Hovern">
          <span className="text-[12.5px] text-muted-foreground">
            Der <Abbr term="ROI" /> berücksichtigt die Gebühren aus den Einstellungen.
          </span>
          <AbbreviationTooltip term="ROI" showIcon>
            <span className="text-[12.5px] font-semibold text-foreground">mit Icon</span>
          </AbbreviationTooltip>
        </Specimen>
        <Separator />
        <Specimen code="LoadingSkeletons — je Layout eines, damit ein Ladezustand nie eine falsche Null zeigt" className="flex-col items-stretch">
          <PageHeaderSkeleton />
          <StatsCardsSkeleton count={4} />
          <div className="grid gap-3 lg:grid-cols-2">
            <CardSkeleton rows={3} />
            <TableSkeleton rows={4} columns={4} />
          </div>
          <ChartSkeleton height={200} />
        </Specimen>
      </Section>
    </div>
  );
}

export default DesignSystemPage;
