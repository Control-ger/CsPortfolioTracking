import { Separator } from "@packages/shared";

export const Horizontal = () => (
  <div className="w-[380px]">
    <div className="text-sm font-medium">Portfolio</div>
    <p className="text-sm text-muted-foreground">312 Positionen</p>
    <Separator className="my-4" />
    <div className="flex h-6 items-center gap-3 text-sm">
      <span>EUR</span>
      <Separator orientation="vertical" />
      <span className="text-muted-foreground">USD</span>
    </div>
  </div>
);
