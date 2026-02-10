import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

export const InventoryTable = ({ investments, onSelectItem }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Item</TableHead>
        <TableHead className="text-right">Menge</TableHead>
        <TableHead className="text-right">Einkauf</TableHead>
        <TableHead className="text-right">Live (CSFloat)</TableHead>
        <TableHead className="text-right">ROI %</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {investments.map((item) => (
        <TableRow
          key={item.id}
          className="cursor-pointer hover:bg-muted/50 transition-colors group"
          onClick={() => onSelectItem(item)}
        >
          <TableCell className="font-medium text-sm">
            <span className="flex flex-col">
              <span className="group-hover:text-primary transition-colors">
                {item.name}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-tighter">
                {item.type === "case" ? "Behälter" : "Aufkleber"}
              </span>
            </span>
          </TableCell>
          <TableCell className="text-right font-mono text-xs text-muted-foreground">
            {item.quantity}x
          </TableCell>
          <TableCell className="text-right text-xs">
            {item.buyPrice.toFixed(2)}€
          </TableCell>

          {/* Live-Preis Spalte mit Status-Check */}
          <TableCell
            className={`text-right font-bold text-sm ${item.isLive ? "text-primary" : "text-muted-foreground"}`}
          >
            {item.isLive ? (
              `${item.livePrice.toFixed(2)}€`
            ) : (
              <div className="flex flex-col items-end">
                <span className="text-xs">{item.buyPrice.toFixed(2)}€</span>
                <span className="text-[9px] animate-pulse uppercase">
                  Warte...
                </span>
              </div>
            )}
          </TableCell>

          <TableCell
            className={`text-right font-bold text-sm ${
              item.roi >= 0 ? "text-green-500" : "text-red-500"
            }`}
          >
            {/* Zeigt ROI basierend auf dem verfügbaren Preis (Live oder Fix) */}
            {item.isLive ? (
              `${item.roi >= 0 ? "+" : ""}${item.roi.toFixed(1)}%`
            ) : (
              <span className="text-muted-foreground opacity-50">0.0%</span>
            )}
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
