import { useState, useEffect } from 'react';
import { fetchPortfolioComposition } from '@/lib/dataSource.js';

export function usePortfolioComposition() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadComposition = async () => {
      try {
        const result = await fetchPortfolioComposition();
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
  }, []);

  return { data, loading, error };
}
