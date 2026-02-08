import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
export const StatCard = ({ title, value, subValue, isPositive }) => (
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
        {title}
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div className="flex flex-col">
        <div className="text-2xl font-bold">{value}</div>
        {subValue && (
          <div
            className={`text-xs font-bold flex items-center mt-1 ${isPositive ? "text-green-600" : "text-red-600"}`}
          >
            {isPositive ? "▲" : "▼"} {subValue}
            <span className="text-muted-foreground font-normal ml-1">
              seit Start
            </span>
          </div>
        )}
      </div>
    </CardContent>
  </Card>
);
