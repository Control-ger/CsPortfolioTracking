import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Badge, Button } from "@packages/shared";

export const Default = () => (
  <Card className="w-[380px]">
    <CardHeader>
      <CardTitle>AK-47 | Leet Museo</CardTitle>
      <CardDescription>Minimal Wear · gekauft am 14.03.2026</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-semibold tabular-nums">213,23 €</span>
        <span className="text-sm font-medium text-destructive tabular-nums">-11,19 %</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">Einstand 240,08 € · 1 Position</p>
    </CardContent>
  </Card>
);

export const WithFooter = () => (
  <Card className="w-[380px]">
    <CardHeader>
      <CardTitle>Portfolio-Wert</CardTitle>
      <CardDescription>Alle Positionen, EUR</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="text-3xl font-semibold tabular-nums">12.480,55 €</div>
      <div className="mt-1 text-sm font-medium text-success tabular-nums">+842,10 € (+7,24 %)</div>
    </CardContent>
    <CardFooter className="justify-between">
      <Badge variant="outline">Zuletzt 20:33</Badge>
      <Button size="sm" variant="outline">Aktualisieren</Button>
    </CardFooter>
  </Card>
);

export const Compact = () => (
  <Card className="w-[260px]">
    <CardHeader className="pb-2">
      <CardDescription>Offene Buyorders</CardDescription>
      <CardTitle className="text-2xl tabular-nums">7</CardTitle>
    </CardHeader>
    <CardContent>
      <p className="text-xs text-muted-foreground">Gebundenes Kapital 318,40 €</p>
    </CardContent>
  </Card>
);
