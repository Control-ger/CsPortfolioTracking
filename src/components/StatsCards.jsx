import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.jsx";

export const StatCard = ({
  title,
  value,
  subValue,
  primaryValue,
  secondaryValue,
  primaryLabel = "Brutto",
  secondaryLabel = "Netto",
  isPositive,
}) => {
  const hasStatus = isPositive !== undefined;
  const statusColor = isPositive ? "text-green-600" : "text-red-600";
  const mainValue = primaryValue ?? value;
  const sideValue = secondaryValue ?? subValue;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">{primaryLabel}</div>
            <div className={`text-2xl font-bold ${hasStatus ? statusColor : ""}`}>
              {mainValue}
            </div>
          </div>

          {sideValue ? (
            <div className="border-t pt-2">
              <div className="text-[10px] uppercase text-muted-foreground">{secondaryLabel}</div>
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
      </CardContent>
    </Card>
  );
};
