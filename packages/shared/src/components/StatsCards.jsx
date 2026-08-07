import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@shared/components/ui/card.jsx";
import { Skeleton } from "@shared/components/ui/skeleton.jsx";
import { FieldLabel } from "@shared/components/ui/data-display";

export const StatCard = ({
  title,
  value,
  subValue,
  primaryValue,
  secondaryValue,
  primaryLabel = "Brutto",
  secondaryLabel = "Netto",
  isPositive,
  isLoading = false,
}) => {
  const hasStatus = isPositive !== undefined;
  const statusColor = isPositive ? "text-success" : "text-danger";
  const hasDualMetricLayout = primaryValue !== undefined || secondaryValue !== undefined;
  const mainValue = primaryValue ?? value;
  const sideValue = secondaryValue ?? subValue;
  const hasSideValue = sideValue !== undefined && sideValue !== null && sideValue !== "";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-28" />
            {hasSideValue ? <Skeleton className="h-3 w-40" /> : null}
          </div>
        ) : hasDualMetricLayout ? (
          <div className="space-y-2">
            <div>
              <FieldLabel>{primaryLabel}</FieldLabel>
              <div className={`text-2xl font-bold ${hasStatus ? statusColor : ""}`}>
                {mainValue}
              </div>
            </div>

            {hasSideValue ? (
              <div className="border-t pt-2">
                <FieldLabel>{secondaryLabel}</FieldLabel>
                <div className="text-xs flex items-center mt-1">
                  {hasStatus && (
                    <span className={`font-bold mr-1 ${statusColor}`}>
                      {isPositive ? "▲" : "▼"}
                    </span>
                  )}
                  <span className="text-muted-foreground">{sideValue}</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1">
            <div className={`text-2xl font-bold ${hasStatus ? statusColor : ""}`}>{value}</div>
            {hasSideValue ? (
              <div className="text-xs flex items-center">
                {hasStatus && (
                  <span className={`font-bold mr-1 ${statusColor}`}>{isPositive ? "▲" : "▼"}</span>
                )}
                <span className="text-muted-foreground">{subValue}</span>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
