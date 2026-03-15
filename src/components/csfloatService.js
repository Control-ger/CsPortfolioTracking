const priceCache = {};

export const getLivePrice = async (marketHashName) => {
  if (priceCache[marketHashName]) {
    return priceCache[marketHashName];
  }

  try {
    const encodedName = encodeURIComponent(marketHashName);

    // WICHTIG: Wir rufen jetzt deinen eigenen Server-Proxy auf!
    // Da deine App auf :***REMOVED*** läuft, ist der Pfad /api/...
    const url = `/api/csfloat_proxy.php?market_hash_name=${encodedName}`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const json = await response.json();

    // Achtung: Prüfe ob CSFloat "data" oder "listings" zurückgibt.
    // Im PHP Proxy oben ist es die Original-Struktur von CSFloat.
    if (json.data && json.data.length > 0) {
      const price = json.data[0].price / 100;
      priceCache[marketHashName] = price;
      return price;
    }
    return null;
  } catch (error) {
    console.error("Proxy-Fehler:", error);
    return null;
  }
};
