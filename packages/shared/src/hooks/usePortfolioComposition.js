import { useState, useEffect } from 'react';
import { fetchPortfolioCompositionData } from '../lib/dataSource.js';

export function usePortfolioComposition(refreshToken = 0) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadComposition = async () => {
      try {
        const result = await fetchPortfolioCompositionData();
        setData(result || []);
        setError('');
      } catch (err) {
        setError(err.message || 'Fehler beim Laden der Portfolio-Zusammensetzung');
        setData([]);
      } finally {
        setLoading(false);
      }
    };

    loadComposition();
  }, [refreshToken]);

  return { data, loading, error };
}
