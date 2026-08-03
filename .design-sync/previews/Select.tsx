import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectSeparator } from "@packages/shared";

export const Open = () => (
  <Select defaultValue="csfloat" open>
    <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
    <SelectContent position="item-aligned">
      <SelectGroup>
        <SelectLabel>Preisquelle</SelectLabel>
        <SelectItem value="csfloat">CSFloat</SelectItem>
        <SelectItem value="steam">Steam Market</SelectItem>
        <SelectItem value="skinbaron">SkinBaron</SelectItem>
      </SelectGroup>
      <SelectSeparator />
      <SelectGroup>
        <SelectLabel>Währung</SelectLabel>
        <SelectItem value="eur">EUR</SelectItem>
        <SelectItem value="usd">USD</SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>
);

export const Closed = () => (
  <Select defaultValue="eur">
    <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
    <SelectContent><SelectItem value="eur">EUR</SelectItem><SelectItem value="usd">USD</SelectItem></SelectContent>
  </Select>
);
