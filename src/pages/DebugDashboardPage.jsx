import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchDebugLogs } from "@/lib/apiClient";

const DEBUG_LOG_LIMIT = 500;
const ALL_FILTER_VALUE = "all";
const LOG_LINE_PATTERN =
  /^\[([^\]]+)]\s+([A-Z]+)\s+([a-zA-Z0-9_.-]+):\s*(.*?)(?:\s+\|\s+requestId=([^|]+))?(?:\s+\|\s+status=([^|]+))?(?:\s+\|\s+durationMs=([^|]+))?(?:\s+\|\s+context=(.*))?$/;
const LEVEL_SORT_RANK = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  CRITICAL: 50,
  FATAL: 60,
};

function normalizeLevel(level) {
  const normalized = String(level || "INFO").toUpperCase();

  if (normalized === "WARNING") {
    return "WARN";
  }

  return normalized || "INFO";
}

function getLevelSortRank(level) {
  return LEVEL_SORT_RANK[String(level || "").toUpperCase()] ?? 999;
}

function safeJsonParse(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return {};
  }

  return {};
}

function deriveProvider(eventName, context) {
  if (typeof context?.provider === "string" && context.provider.trim() !== "") {
    return context.provider;
  }

  const normalizedEventName = String(eventName || "").toLowerCase();
  if (normalizedEventName.includes("csfloat")) {
    return "csfloat";
  }
  if (normalizedEventName.includes("steam")) {
    return "steam";
  }

  return "-";
}

function extractItemName(context) {
  const candidates = [
    context?.itemName,
    context?.marketHashName,
    context?.market_hash_name,
    context?.item,
    context?.name,
  ];

  const itemName = candidates.find(
    (candidate) => typeof candidate === "string" && candidate.trim() !== "",
  );

  return itemName || "-";
}

function normalizeEvent(event, fallbackLine, index) {
  const context =
    event?.context && typeof event.context === "object" && !Array.isArray(event.context)
      ? event.context
      : {};
  const eventName = String(event?.event || "unknown.event").trim();
  const timestamp = String(event?.timestamp || "").trim();
  const requestId = String(event?.requestId || "").trim();
  const provider = String(deriveProvider(eventName, context) || "-").trim();
  const itemName = String(extractItemName(context) || "-").trim();

  return {
    id: `event-${index}-${timestamp || "no-ts"}-${requestId || "no-req"}-${eventName}`,
    timestamp,
    level: normalizeLevel(event?.level),
    eventName,
    provider,
    itemName,
    requestId,
    message: String(event?.message || "").trim(),
    rawLine: fallbackLine || "",
  };
}

function parseLegacyLine(line, index) {
  const rawLine = String(line || "");
  const match = rawLine.match(LOG_LINE_PATTERN);

  if (!match) {
    return {
      id: `legacy-unparsed-${index}`,
      timestamp: "",
      level: "INFO",
      eventName: "legacy.unparsed_line",
      provider: "-",
      itemName: "-",
      requestId: "",
      message: rawLine,
      rawLine,
    };
  }

  const context = safeJsonParse(match[8]);
  const eventName = String(match[3] || "unknown.event").trim();
  const timestamp = String(match[1] || "").trim();
  const requestId = String(match[5] || "").trim();
  const provider = String(deriveProvider(eventName, context) || "-").trim();
  const itemName = String(extractItemName(context) || "-").trim();

  return {
    id: `legacy-${index}-${timestamp || "no-ts"}-${requestId || "no-req"}-${eventName}`,
    timestamp,
    level: normalizeLevel(match[2]),
    eventName,
    provider,
    itemName,
    requestId,
    message: String(match[4] || "").trim(),
    rawLine,
  };
}

function mapPayloadToRows(payload) {
  const logs = Array.isArray(payload?.logs) ? payload.logs : [];
  const events = Array.isArray(payload?.events) ? payload.events : [];

  if (events.length > 0) {
    return events.map((event, index) => normalizeEvent(event, logs[index] ?? "", index));
  }

  return logs.map((line, index) => parseLegacyLine(line, index));
}

async function fetchDebugRowsFromApi() {
  const payload = await fetchDebugLogs({
    type: "app",
    limit: DEBUG_LOG_LIMIT,
  });

  return {
    rows: mapPayloadToRows(payload),
    source: typeof payload?.source === "string" ? payload.source : "unknown",
  };
}

function levelBadgeClass(level) {
  switch (level) {
    case "INFO":
      return "border-blue-200 bg-blue-500/10 text-blue-700 dark:border-blue-900/60 dark:text-blue-300";
    case "WARN":
      return "border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-900/60 dark:text-amber-300";
    case "ERROR":
    case "CRITICAL":
    case "FATAL":
      return "border-red-200 bg-red-500/10 text-red-700 dark:border-red-900/60 dark:text-red-300";
    case "DEBUG":
      return "border-slate-200 bg-slate-500/10 text-slate-700 dark:border-slate-700 dark:text-slate-300";
    default:
      return "border-muted text-muted-foreground";
  }
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "-";
  }

  const parsedDate = new Date(timestamp);
  if (Number.isNaN(parsedDate.getTime())) {
    return timestamp;
  }

  return parsedDate.toLocaleString("de-DE", { hour12: false });
}

export function DebugDashboardPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState("unknown");
  const [fetchedAt, setFetchedAt] = useState(null);
  const [eventFilter, setEventFilter] = useState(ALL_FILTER_VALUE);
  const [itemFilter, setItemFilter] = useState(ALL_FILTER_VALUE);
  const [requestIdQuery, setRequestIdQuery] = useState("");
  const [sortConfig, setSortConfig] = useState({
    key: "timestamp",
    direction: "desc",
  });

  const refreshLogs = async () => {
    setLoading(true);
    setError("");

    try {
      const result = await fetchDebugRowsFromApi();
      setRows(result.rows);
      setSource(result.source);
      setFetchedAt(new Date());
    } catch (logsError) {
      console.error("Fehler beim Laden der Debug-Logs:", logsError);
      setRows([]);
      setError(logsError?.message || "Debug-Logs konnten nicht geladen werden.");
      setFetchedAt(new Date());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadInitialRows = async () => {
      setLoading(true);
      setError("");

      try {
        const result = await fetchDebugRowsFromApi();
        if (cancelled) {
          return;
        }

        setRows(result.rows);
        setSource(result.source);
        setFetchedAt(new Date());
      } catch (logsError) {
        if (cancelled) {
          return;
        }

        console.error("Fehler beim Laden der Debug-Logs:", logsError);
        setRows([]);
        setError(logsError?.message || "Debug-Logs konnten nicht geladen werden.");
        setFetchedAt(new Date());
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadInitialRows();

    return () => {
      cancelled = true;
    };
  }, []);

  const eventOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.eventName).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [rows]);

  const itemOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.itemName).filter((value) => value && value !== "-"))).sort(
      (a, b) => a.localeCompare(b),
    );
  }, [rows]);

  const filteredRows = useMemo(() => {
    const requestNeedle = requestIdQuery.trim().toLowerCase();
    const eventNeedle = eventFilter.trim().toLowerCase();
    const itemNeedle = itemFilter.trim().toLowerCase();

    return rows.filter((row) => {
      const rowEvent = String(row.eventName || "").trim().toLowerCase();
      const rowItem = String(row.itemName || "").trim().toLowerCase();

      if (eventNeedle !== ALL_FILTER_VALUE && rowEvent !== eventNeedle) {
        return false;
      }

      if (itemNeedle !== ALL_FILTER_VALUE && rowItem !== itemNeedle) {
        return false;
      }

      if (requestNeedle !== "") {
        const requestCandidate = String(row.requestId || "").toLowerCase();
        const rawCandidate = String(row.rawLine || "").toLowerCase();
        if (!requestCandidate.includes(requestNeedle) && !rawCandidate.includes(requestNeedle)) {
          return false;
        }
      }

      return true;
    });
  }, [eventFilter, itemFilter, requestIdQuery, rows]);

  const sortedRows = useMemo(() => {
    const direction = sortConfig.direction === "asc" ? 1 : -1;
    return [...filteredRows].sort((first, second) => {
      if (sortConfig.key === "level") {
        const rankDiff = getLevelSortRank(first.level) - getLevelSortRank(second.level);
        if (rankDiff !== 0) {
          return rankDiff * direction;
        }
      }

      if (sortConfig.key === "timestamp") {
        const firstTs = Date.parse(String(first.timestamp || ""));
        const secondTs = Date.parse(String(second.timestamp || ""));
        const firstValue = Number.isNaN(firstTs) ? 0 : firstTs;
        const secondValue = Number.isNaN(secondTs) ? 0 : secondTs;
        const tsDiff = firstValue - secondValue;
        if (tsDiff !== 0) {
          return tsDiff * direction;
        }
      }

      return first.id.localeCompare(second.id);
    });
  }, [filteredRows, sortConfig]);

  const handleToggleSort = (key) => {
    setSortConfig((previous) => {
      if (previous.key === key) {
        return {
          key,
          direction: previous.direction === "asc" ? "desc" : "asc",
        };
      }

      return {
        key,
        direction: key === "timestamp" ? "desc" : "asc",
      };
    });
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:p-8 font-sans text-foreground pb-20 md:pb-0">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col sm:flex-row items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Observability
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-primary">Debug Panel</h1>
            <p className="text-muted-foreground">
              Strukturierte Application Logs mit Event-, Item- und Request-ID-Filtern.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button variant="outline" asChild>
                <Link to="/">Zurueck zum Portfolio</Link>
              </Button>
              <Badge variant="outline">Quelle: {source}</Badge>
              {fetchedAt && (
                <Badge variant="secondary">
                  Letztes Update: {fetchedAt.toLocaleTimeString("de-DE", { hour12: false })}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Filter und Suche</CardTitle>
            <CardDescription>Filtere nach Event-Typ, Item und Request-ID.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Request-ID Suche</p>
                <Input
                  value={requestIdQuery}
                  onChange={(event) => setRequestIdQuery(event.target.value)}
                  placeholder="req_..."
                />
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Event-Typ</p>
                <Select value={eventFilter} onValueChange={setEventFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Alle Events" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[280px] md:max-h-[350px]">
                    <SelectItem value={ALL_FILTER_VALUE}>Alle Events</SelectItem>
                    {eventOptions.map((eventName) => (
                      <SelectItem key={eventName} value={eventName}>
                        {eventName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Item-Name</p>
                <Select value={itemFilter} onValueChange={setItemFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Alle Items" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[280px] md:max-h-[350px]">
                    <SelectItem value={ALL_FILTER_VALUE}>Alle Items</SelectItem>
                    {itemOptions.map((itemName) => (
                      <SelectItem key={itemName} value={itemName}>
                        {itemName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Aktion</p>
                <Button onClick={() => void refreshLogs()} disabled={loading} className="w-full" variant="secondary">
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  {loading ? "Laedt..." : "Neu laden"}
                </Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              {filteredRows.length} von {rows.length} Eintraegen sichtbar.
            </div>

            {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="border-b ">
            <CardTitle className="text-base">Application Logs</CardTitle>
            <CardDescription>
              Farbcodierte Level in einer scrollbaren Tabelle fuer schnelle Analyse.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading && rows.length === 0 ? (
              <div className="space-y-2 p-6">
                {[1, 2, 3, 4, 5, 6].map((entry) => (
                  <Skeleton key={entry} className="h-10 w-full" />
                ))}
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">Keine Log-Eintraege fuer den aktuellen Filter.</div>
            ) : (
              <ScrollArea className="h-[560px]">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="w-[190px]">
                        <button
                          type="button"
                          onClick={() => handleToggleSort("timestamp")}
                          className="inline-flex items-center gap-1.5 text-left font-medium text-muted-foreground transition-colors hover:text-foreground"
                          aria-label="Nach Zeit sortieren"
                          title="Nach Zeit sortieren"
                        >
                          Zeit
                          {sortConfig.key === "timestamp" ? (
                            sortConfig.direction === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-70" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead className="w-[100px]">
                        <button
                          type="button"
                          onClick={() => handleToggleSort("level")}
                          className="inline-flex items-center gap-1.5 text-left font-medium text-muted-foreground transition-colors hover:text-foreground"
                          aria-label="Nach Level sortieren"
                          title="Nach Level sortieren"
                        >
                          Level
                          {sortConfig.key === "level" ? (
                            sortConfig.direction === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-70" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead className="w-[280px]">Event</TableHead>
                      <TableHead className="w-[120px]">Provider</TableHead>
                      <TableHead className="w-[220px]">Item</TableHead>
                      <TableHead className="w-[220px]">Request ID</TableHead>
                      <TableHead>Nachricht</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs">{formatTimestamp(row.timestamp)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={levelBadgeClass(row.level)}>
                            {row.level}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.eventName}</TableCell>
                        <TableCell className="font-mono text-xs">{row.provider}</TableCell>
                        <TableCell className="font-mono text-xs">{row.itemName || "-"}</TableCell>
                        <TableCell className="font-mono text-xs">{row.requestId || "-"}</TableCell>
                        <TableCell className="max-w-[460px] truncate text-xs" title={row.message || row.rawLine}>
                          {row.message || row.rawLine || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
