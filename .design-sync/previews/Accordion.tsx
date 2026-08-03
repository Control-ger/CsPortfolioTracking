import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@packages/shared";

export const Default = () => (
  <Accordion type="single" collapsible defaultValue="fees" className="w-[520px]">
    <AccordionItem value="fees">
      <AccordionTrigger>Gebühren</AccordionTrigger>
      <AccordionContent>
        CSFloat berechnet 2 % Verkäufergebühr. Der Break-even-Preis berücksichtigt sie automatisch.
      </AccordionContent>
    </AccordionItem>
    <AccordionItem value="sources">
      <AccordionTrigger>Preisquellen</AccordionTrigger>
      <AccordionContent>
        Primär CSFloat, Fallback Steam Market. Die Aktualität steht auf jeder Position.
      </AccordionContent>
    </AccordionItem>
  </Accordion>
);
