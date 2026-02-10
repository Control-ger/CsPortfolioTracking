// Einfacher Abruf des aktuellen Kurses (kostenlose API)
export const getExchangeRate = async () => {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await res.json();
    return data.rates.EUR; // Gibt z.B. 0.924... zurück
  } catch (error) {
    console.error("Wechselkurs-Fehler:", error);
    return 0.92; // Fallback
  }
};
