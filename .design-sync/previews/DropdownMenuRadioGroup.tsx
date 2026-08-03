import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuGroup, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuShortcut, Button } from "@packages/shared";

// DropdownMenuRadioGroup only renders inside an open menu — the card shows that composition.
export const InContext = () => (
  <DropdownMenu open modal={false}>
    <DropdownMenuTrigger asChild><Button variant="outline">Aktionen</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="bottom" sideOffset={4} avoidCollisions={false}>
      <DropdownMenuLabel>Position</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem>Bearbeiten<DropdownMenuShortcut>⌘E</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem>Zum Inventar</DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuRadioGroup value="eur">
        <DropdownMenuRadioItem value="eur">EUR</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="usd">USD</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);
