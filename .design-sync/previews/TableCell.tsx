import { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption } from "@packages/shared";

// TableCell only renders inside a table — the card shows the composition it belongs to.
export const InContext = () => (
  <Table className="w-[560px]">
    <TableCaption>Positionen im Bucket „Investment"</TableCaption>
    <TableHeader>
      <TableRow>
        <TableHead>Item</TableHead>
        <TableHead className="text-right">Menge</TableHead>
        <TableHead className="text-right">Live-Preis</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow><TableCell className="font-medium">Recoil Case</TableCell><TableCell className="text-right tabular-nums">96x</TableCell><TableCell className="text-right tabular-nums">0,27 €</TableCell></TableRow>
      <TableRow><TableCell className="font-medium">Fracture Case</TableCell><TableCell className="text-right tabular-nums">177x</TableCell><TableCell className="text-right tabular-nums">0,40 €</TableCell></TableRow>
    </TableBody>
    <TableFooter>
      <TableRow><TableCell>Summe</TableCell><TableCell className="text-right tabular-nums">273x</TableCell><TableCell className="text-right tabular-nums">96,72 €</TableCell></TableRow>
    </TableFooter>
  </Table>
);
