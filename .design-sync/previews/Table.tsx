import { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption, Badge } from "@packages/shared";

const rows = [
  { name: "Recoil Case", qty: "96x", price: "0,27 €", roi: "+35,2 %", up: true },
  { name: "Fracture Case", qty: "177x", price: "0,40 €", roi: "+1,6 %", up: true },
  { name: "Revolution Case", qty: "467x", price: "0,22 €", roi: "-15,9 %", up: false },
  { name: "AWP | Duality (MW)", qty: "1x", price: "4,53 €", roi: "-25,8 %", up: false },
];

export const Default = () => (
  <Table className="w-[640px]">
    <TableHeader>
      <TableRow>
        <TableHead>Item</TableHead>
        <TableHead className="text-right">Menge</TableHead>
        <TableHead className="text-right">Live-Preis</TableHead>
        <TableHead className="text-right">ROI</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.map((r) => (
        <TableRow key={r.name}>
          <TableCell className="font-medium">{r.name}</TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">{r.qty}</TableCell>
          <TableCell className="text-right tabular-nums">{r.price}</TableCell>
          <TableCell className={`text-right tabular-nums font-medium ${r.up ? "text-success" : "text-destructive"}`}>{r.roi}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const WithCaptionAndFooter = () => (
  <Table className="w-[640px]">
    <TableCaption>Positionen im Bucket „Investment", Stand 20:33</TableCaption>
    <TableHeader>
      <TableRow>
        <TableHead>Item</TableHead>
        <TableHead className="text-right">Positionswert</TableHead>
        <TableHead>Status</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow><TableCell className="font-medium">Recoil Case</TableCell><TableCell className="text-right tabular-nums">25,85 €</TableCell><TableCell><Badge variant="outline">frisch</Badge></TableCell></TableRow>
      <TableRow><TableCell className="font-medium">Gallery Case</TableCell><TableCell className="text-right tabular-nums">283,50 €</TableCell><TableCell><Badge variant="outline" className="border-warning/35 bg-warning/12 text-warning">veraltet</Badge></TableCell></TableRow>
    </TableBody>
    <TableFooter>
      <TableRow><TableCell>Summe</TableCell><TableCell className="text-right tabular-nums">309,35 €</TableCell><TableCell /></TableRow>
    </TableFooter>
  </Table>
);
