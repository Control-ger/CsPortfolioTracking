const CACHE_PREFIX = "cs-portfolio-cache:";

function canUseElectronFileCache() {
  return (
    typeof window !== "undefined" &&
    window.electronAPI &&
    typeof window.electronAPI.localFileRead === "function" &&
    typeof window.electronAPI.localFileWrite === "function"
  );
}

function storageKey(key) {
  return `${CACHE_PREFIX}${key}`;
}

function parseCacheEntry(rawValue, key) {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed =
      typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    if (parsed && typeof parsed === "object" && "data" in parsed) {
      return parsed.data;
    }
    return parsed;
  } catch (error) {
    console.warn(`[localCache] failed to parse cache entry for ${key}`, error);
    return null;
  }
}

export async function get(key) {
  try {
    if (canUseElectronFileCache()) {
      const rawValue = await window.electronAPI.localFileRead(key);
      return parseCacheEntry(rawValue, key);
    }

    if (typeof window !== "undefined" && window.localStorage) {
      return parseCacheEntry(window.localStorage.getItem(storageKey(key)), key);
    }
  } catch (error) {
    console.warn(`[localCache] failed to read cache entry for ${key}`, error);
  }

  return null;
}

export async function set(key, value) {
  try {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      data: value,
    });

    if (canUseElectronFileCache()) {
      return Boolean(await window.electronAPI.localFileWrite(key, entry));
    }

    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(storageKey(key), entry);
      return true;
    }
  } catch (error) {
    console.warn(`[localCache] failed to write cache entry for ${key}`, error);
  }

  return false;
}

export async function remove(key) {
  try {
    if (
      typeof window !== "undefined" &&
      window.electronAPI &&
      typeof window.electronAPI.localFileRemove === "function"
    ) {
      return Boolean(await window.electronAPI.localFileRemove(key));
    }

    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(storageKey(key));
      return true;
    }
  } catch (error) {
    console.warn(`[localCache] failed to remove cache entry for ${key}`, error);
  }

  return false;
}
