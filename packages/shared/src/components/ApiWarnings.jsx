import { AlertTriangle } from "lucide-react";

export const ApiWarnings = ({ warnings = [], className = "" }) => {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return null;
  }

  return (
    <div
      className={`rounded-xl border border-amber-400/35 bg-amber-500/12 p-3 text-amber-200 ${className}`.trim()}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4" />
        CSFloat Warnungen
      </div>
      <div className="mt-2 space-y-2">
        {warnings.map((warning) => {
          const key = `${warning.code || "warning"}-${warning.statusCode || "na"}`;
          const metaParts = [];

          if (warning.statusCode) {
            metaParts.push(`HTTP ${warning.statusCode}`);
          }

          if (warning.occurrences > 1) {
            metaParts.push(`${warning.occurrences} Vorgaenge`);
          }

          if (Array.isArray(warning.items) && warning.items.length > 0) {
            metaParts.push(`Items: ${warning.items.join(", ")}`);
          }

          return (
            <div key={key} className="text-sm">
              <p>{warning.message}</p>
              {metaParts.length > 0 && (
                <p className="mt-1 text-xs text-amber-200/75">
                  {metaParts.join(" | ")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
