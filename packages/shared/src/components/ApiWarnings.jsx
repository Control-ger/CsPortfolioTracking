import { AlertTriangle } from "lucide-react";

import { Callout } from "./ui/callout.jsx";

export const ApiWarnings = ({ warnings = [], className = "" }) => {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return null;
  }

  return (
    <Callout
      tone="warn"
      icon={<AlertTriangle className="size-4" />}
      title="CSFloat Warnungen"
      className={className}
    >
      <div className="space-y-2">
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
                <p className="mt-1 text-xs text-muted-foreground">
                  {metaParts.join(" | ")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Callout>
  );
};
