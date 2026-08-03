import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectSeparator } from "@packages/shared";

// SelectSeparator only renders inside an open select — the card shows that composition.
export const InContext = () => (
  <Select defaultValue="csfloat" open>
    <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
    <SelectContent position="item-aligned">
      <SelectGroup>
        <SelectLabel>Preisquelle</SelectLabel>
        <SelectItem value="csfloat">CSFloat</SelectItem>
        <SelectItem value="steam">Steam Market</SelectItem>
      </SelectGroup>
      <SelectSeparator />
      <SelectGroup>
        <SelectLabel>Währung</SelectLabel>
        <SelectItem value="eur">EUR</SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>
);
