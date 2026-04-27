import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook to make abortable fetch requests
 * Automatically aborts pending requests on unmount or when dependencies change
 * 
 * @returns {Object} { fetchWithAbort, abort, isAborted }
 */
export function useAbortableFetch() {
  const abortControllerRef = useRef(null);
  const isAbortedRef = useRef(false);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const fetchWithAbort = useCallback(async (fetchFn, options = {}) => {
    // Abort any pending request
    abort();
    
    // Create new abort controller
    abortControllerRef.current = new AbortController();
    isAbortedRef.current = false;

    try {
      const result = await fetchFn(abortControllerRef.current.signal);
      return { success: true, data: result, aborted: false };
    } catch (error) {
      if (error.name === 'AbortError') {
        isAbortedRef.current = true;
        return { success: false, error, aborted: true };
      }
      return { success: false, error, aborted: false };
    }
  }, [abort]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abort();
    };
  }, [abort]);

  return {
    fetchWithAbort,
    abort,
    isAborted: () => isAbortedRef.current,
    getSignal: () => abortControllerRef.current?.signal,
  };
}

/**
 * Hook for abortable useEffect with async operations
 * @param {Function} effect - Async effect function that receives abort signal
 * @param {Array} deps - Dependencies array
 */
export function useAbortableEffect(effect, deps = []) {
  useEffect(() => {
    const abortController = new AbortController();
    
    effect(abortController.signal);

    return () => {
      abortController.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
