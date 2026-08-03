import { ScrollArea, Separator } from "@packages/shared";

const items = ["Recoil Case", "Fracture Case", "Revolution Case", "Snakebite Case", "Gallery Case", "Fever Case", "Kilowatt Case", "Dreams & Nightmares Case"];

export const Default = () => (
  <ScrollArea className="h-[180px] w-[320px] rounded-md border border-border p-3">
    {items.map((n, i) => (
      <div key={n}>
        <div className="py-2 text-sm">{n}</div>
        {i < items.length - 1 ? <Separator /> : null}
      </div>
    ))}
  </ScrollArea>
);
