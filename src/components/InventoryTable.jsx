import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

const ItemThumbnail = ({ imageUrl, name }) => (
  <div className="h-12 w-12 overflow-hidden rounded-md border bg-muted">
    {imageUrl ? (
      <img
        src={imageUrl}
        alt={name}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    ) : (
      <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
        N/A
      </div>
    )}
  </div>
);

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
          className="group cursor-pointer transition-colors hover:bg-muted/50"
          onClick={() => onSelectItem(item)}
        >
          <TableCell className="font-medium text-sm">
            <div className="flex items-center gap-3">
              <ItemThumbnail imageUrl={item.imageUrl} name={item.name} />
              <span className="flex flex-col">
                <span className="transition-colors group-hover:text-primary">
                  {item.name}
                </span>
                <span className="text-[10px] uppercase tracking-tighter text-muted-foreground">
                  {item.type}
                </span>
              </span>
            </div>
          </TableCell>
          <TableCell className="text-right font-mono text-xs text-muted-foreground">
            {item.quantity}x
          </TableCell>
          <TableCell className="text-right text-xs">
            {item.buyPrice.toFixed(2)} EUR
          </TableCell>
          <TableCell
            className={`text-right text-sm font-bold ${item.isLive ? "text-primary" : "text-muted-foreground"}`}
          >
            {item.isLive ? (
              `${item.livePrice.toFixed(2)} EUR`
            ) : (
              <div className="flex flex-col items-end">
                <span className="text-xs">{item.buyPrice.toFixed(2)} EUR</span>
                <span className="animate-pulse text-[9px] uppercase">
                  Warte...
                </span>
              </div>
            )}
          </TableCell>
          <TableCell
            className={`text-right text-sm font-bold ${
              item.roi >= 0 ? "text-green-500" : "text-red-500"
            }`}
          >
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
