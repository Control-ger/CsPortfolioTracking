export function unwrapLocalStoreResult(result, contextLabel = "local-store") {
  if (result && typeof result === "object" && result.error) {
    const error = new Error(result.error || "Local store operation failed");
    error.channel = result.channel || contextLabel;
    throw error;
  }

  return result;
}

