// Ein einfaches Objekt außerhalb der Funktion dient als Speicher
const priceCache = {};

export const getLivePrice = async (marketHashName) => {
  // 1. Prüfen, ob wir den Preis schon im Speicher haben
  if (priceCache[marketHashName]) {
    console.log(`Cache-Hit für: ${marketHashName}`);
    return priceCache[marketHashName];
  }

  try {
    console.log(`API-Abfrage für: ${marketHashName}`);
    const encodedName = encodeURIComponent(marketHashName);
    const url = `/api/csfloat/listings?market_hash_name=${encodedName}&type=buy_now&sort_by=lowest_price&limit=1`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const json = await response.json();

    if (json.data && json.data.length > 0) {
      const price = json.data[0].price / 100;

      // 2. Preis im Cache speichern für das nächste Mal
      priceCache[marketHashName] = price;

      return price;
    }
    return null;
  } catch (error) {
    console.error("Fehler beim Abrufen des Preises:", error);
    return null;
  }
};
