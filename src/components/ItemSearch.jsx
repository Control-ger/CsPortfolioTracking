import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Search, Plus } from "lucide-react";
import { createWatchlistItem } from "@/lib/apiClient.js";

// Liste mit gängigen CS2 Item-Namen für Vorschläge
const COMMON_ITEMS = [
  "AK-47 | Redline (Field-Tested)",
  "AK-47 | Redline (Well-Worn)",
  "AK-47 | Redline (Battle-Scarred)",
  "AK-47 | Redline (Factory New)",
  "AK-47 | Redline (Minimal Wear)",
  "AWP | Dragon Lore (Factory New)",
  "AWP | Dragon Lore (Minimal Wear)",
  "AWP | Dragon Lore (Field-Tested)",
  "M4A4 | Howl (Factory New)",
  "M4A4 | Howl (Minimal Wear)",
  "Karambit | Fade (Factory New)",
  "Karambit | Fade (Minimal Wear)",
  "Karambit | Fade (Field-Tested)",
  "Karambit | Doppler (Factory New)",
  "Karambit | Doppler (Minimal Wear)",
  "M9 Bayonet | Fade (Factory New)",
  "M9 Bayonet | Fade (Minimal Wear)",
  "Glock-18 | Fade (Factory New)",
  "Glock-18 | Fade (Minimal Wear)",
  "Desert Eagle | Blaze (Factory New)",
  "Desert Eagle | Blaze (Minimal Wear)",
  "AWP | Asiimov (Factory New)",
  "AWP | Asiimov (Minimal Wear)",
  "AWP | Asiimov (Field-Tested)",
  "AWP | Asiimov (Well-Worn)",
  "AWP | Asiimov (Battle-Scarred)",
];

export const ItemSearch = ({ onAddToWatchlist, existingItems = [] }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Filtere Vorschläge basierend auf Suchbegriff
  const handleSearchChange = (value) => {
    setSearchTerm(value);
    setError("");

    if (value.length < 2) {
      setSuggestions([]);
      return;
    }

    const filtered = COMMON_ITEMS.filter((item) =>
      item.toLowerCase().includes(value.toLowerCase())
    );
    setSuggestions(filtered.slice(0, 5)); // Maximal 5 Vorschläge
  };

  const isAlreadyInWatchlist = (itemName) => {
    return existingItems.some((item) => item.name === itemName);
  };

  const handleAddItem = async (itemName) => {
    if (!itemName.trim()) {
      setError("Bitte geben Sie einen Item-Namen ein.");
      return;
    }

    if (isAlreadyInWatchlist(itemName)) {
      setError("Dieses Item ist bereits in der Watchlist.");
      return;
    }

    try {
      setIsSubmitting(true);
      await createWatchlistItem(itemName, "skin");
      setSearchTerm("");
      setSuggestions([]);
      setError("");
      if (onAddToWatchlist) {
        onAddToWatchlist();
      }
    } catch (err) {
      setError(err.message || "Fehler beim Hinzufügen zur Watchlist.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSuggestionClick = (suggestion) => {
    handleAddItem(suggestion);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    handleAddItem(searchTerm);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          CS2 Item suchen
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Item-Name eingeben (z.B. AK-47 | Redline)"
              className="w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={isSubmitting}
            />
            {suggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="w-full text-left px-4 py-2 hover:bg-muted transition-colors"
                    disabled={isAlreadyInWatchlist(suggestion)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm">{suggestion}</span>
                      {isAlreadyInWatchlist(suggestion) && (
                        <span className="text-xs text-muted-foreground">Bereits hinzugefügt</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !searchTerm.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? (
              "Speichere..."
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Zur Watchlist hinzufügen
              </>
            )}
          </button>
        </form>
      </CardContent>
    </Card>
  );
};
