import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem, DropdownMenuShortcut, Button } from "@packages/shared";

export const Open = () => (
  <DropdownMenu open modal={false}>
    <DropdownMenuTrigger asChild><Button variant="outline">Aktionen</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="bottom" sideOffset={4} avoidCollisions={false}>
      <DropdownMenuLabel>Position</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem>Bearbeiten<DropdownMenuShortcut>⌘E</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem>Zum Inventar verschieben</DropdownMenuItem>
      <DropdownMenuCheckboxItem checked>Aus Statistik ausschließen</DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="text-destructive">Entfernen</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
