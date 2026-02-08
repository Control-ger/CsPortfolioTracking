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
        <TableHead>Name</TableHead>
        <TableHead className="text-right">Menge</TableHead>
        <TableHead className="text-right">ROI</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {investments.map((item) => (
        <TableRow
          key={item.id}
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => onSelectItem(item)}
        >
          <TableCell className="font-medium text-sm">
            <span className="flex flex-col">
              {item.name}
              <span className="text-[10px] text-muted-foreground uppercase">
                {item.type}
              </span>
            </span>
          </TableCell>
          <TableCell className="text-right font-mono">
            {item.quantity}x
          </TableCell>
          <TableCell
            className={`text-right font-bold ${item.performance.sinceBuy >= 0 ? "text-green-600" : "text-red-600"}`}
          >
            {item.performance.sinceBuy}%
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
