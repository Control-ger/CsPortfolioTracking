import { Tabs, TabsList, TabsTrigger, TabsContent } from "@packages/shared";

export const Default = () => (
  <Tabs defaultValue="portfolio" className="w-[520px]">
    <TabsList>
      <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
      <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
      <TabsTrigger value="inventory">Inventar</TabsTrigger>
    </TabsList>
    <TabsContent value="portfolio" className="pt-4">
      <p className="text-sm text-muted-foreground">312 Positionen · Gesamtwert 12.480,55 €</p>
    </TabsContent>
  </Tabs>
);
