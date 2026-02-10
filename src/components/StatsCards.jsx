import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.jsx";

export const StatCard = ({ title, value, subValue, isPositive }) => {
  // Wenn isPositive undefined ist (z.B. bei "Items im Bestand"), nutzen wir neutrale Farben
  const hasStatus = isPositive !== undefined;
  const statusColor = isPositive ? "text-green-600" : "text-red-600";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col">
          {/* Der Hauptwert wird nun auch eingefärbt, wenn ein Status da ist */}
          <div className={`text-2xl font-bold ${hasStatus ? statusColor : ""}`}>
            {value}
          </div>

          {subValue && (
            <div className="text-xs flex items-center mt-1">
              {hasStatus && (
                <span className={`font-bold mr-1 ${statusColor}`}>
                  {isPositive ? "▲" : "▼"}
                </span>
              )}
              <span className="text-muted-foreground">{subValue}</span>
              <span className="text-muted-foreground font-normal ml-1">
                seit Start
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
