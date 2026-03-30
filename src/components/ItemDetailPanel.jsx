import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import { Area, AreaChart, ResponsiveContainer, XAxis, Tooltip } from "recharts";

export const ItemDetailPanel = ({ item }) => {
  if (!item)
    return (
      <div className="h-100 flex items-center justify-center border-2 border-dashed rounded-xl p-8 text-center text-muted-foreground">
        Wähle ein Item aus der Liste,
        <br />
        um Details zu sehen.
      </div>
    );

  return (
    <Card className="border-primary/20 shadow-lg">
      <CardHeader>
        <CardTitle className="text-lg">{item.name}</CardTitle>
        <CardDescription className="uppercase text-[10px] font-bold tracking-widest">
          {item.type === "case" ? "Behälter" : "Aufkleber"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-muted/40 p-3 rounded-md border">
            <p className="text-[10px] text-muted-foreground uppercase">
              Einkauf
            </p>
            <p className="text-sm font-bold">{item.buyPrice.toFixed(2)}€</p>
          </div>
          <div className="bg-muted/40 p-3 rounded-md border">
            <p className="text-[10px] text-muted-foreground uppercase">
              Live (CSFloat)
            </p>
            <p className="text-sm font-bold text-primary">
              {item.livePrice ? `${item.livePrice.toFixed(2)}€` : "N/A"}
            </p>
          </div>
        </div>

        {item.details?.stats6m && (
          <div className="pt-4 border-t text-center">
            <h4 className="text-xs font-bold uppercase mb-4 text-muted-foreground">
              Trends (6 Monate) (Work in Progress)
            </h4>
            <div className="h-45 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={item.details.stats6m}>
                  <XAxis dataKey="month" hide />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey={item.type === "case" ? "opened" : "applied"}
                    stroke="hsl(var(--chart-1))"
                    fill="hsl(var(--chart-1))"
                    fillOpacity={0.2}
                  />
                  {item.type === "case" && (
                    <Area
                      type="monotone"
                      dataKey="dropped"
                      stroke="hsl(var(--chart-2))"
                      fill="hsl(var(--chart-2))"
                      fillOpacity={0.2}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
