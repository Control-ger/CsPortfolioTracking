import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent, Button } from "@packages/shared";

export const Open = () => (
  <TooltipProvider>
    <Tooltip open>
      <TooltipTrigger asChild><Button variant="outline">Break-even</Button></TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} avoidCollisions={false}>
        Preis, ab dem die Position nach Gebühren im Plus ist.
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
