const DEFAULT_API_BASE = `${window.location.origin}/api/index.php`
const API_BASE = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE
const TELEMETRY_ENDPOINT = `${API_BASE}/api/v1/observability/frontend-events`

const MAX_EVENTS_PER_MINUTE = 20
const MAX_PAYLOAD_BYTES = 8 * 1024
const MAX_STACK_LINES = 20

let telemetryWindowStartedAt = Date.now()
let telemetryEventsInWindow = 0
let handlersInstalled = false

function normalizeLevel(level) {
  const value = String(level || "").toLowerCase().trim()
  if (value === "debug" || value === "info" || value === "warning" || value === "error") {
    return value
  }

  return "error"
}

function truncateStack(stackValue) {
  if (typeof stackValue !== "string" || stackValue.trim() === "") {
    return undefined
  }

  return stackValue.split("\n").slice(0, MAX_STACK_LINES).join("\n")
}

function truncateString(value, maxLength = 2000) {
  if (typeof value !== "string") {
    return value
  }

  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength)}...[truncated]`
}

function sanitizeForJson(value) {
  try {
    const json = JSON.stringify(value, (_, currentValue) => {
      if (currentValue instanceof Error) {
        return {
          name: currentValue.name,
          message: currentValue.message,
          stack: truncateStack(currentValue.stack),
        }
      }

      if (typeof currentValue === "string") {
        return truncateString(currentValue, 3000)
      }

      return currentValue
    })

    if (!json) {
      return {}
    }

    const parsed = JSON.parse(json)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed
    }

    return { value: parsed }
  } catch {
    return { contextSerializationFailed: true }
  }
}

function isRateLimited() {
  const now = Date.now()
  if (now - telemetryWindowStartedAt >= 60_000) {
    telemetryWindowStartedAt = now
    telemetryEventsInWindow = 0
  }

  if (telemetryEventsInWindow >= MAX_EVENTS_PER_MINUTE) {
    return true
  }

  telemetryEventsInWindow += 1
  return false
}

function buildPayloadJson(payload) {
  let encoded = JSON.stringify(payload)
  if (typeof encoded !== "string") {
    return null
  }

  if (encoded.length <= MAX_PAYLOAD_BYTES) {
    return encoded
  }

  const reducedPayload = {
    level: payload.level,
    event: payload.event,
    message: truncateString(payload.message, 300),
    context: {
      payloadTruncated: true,
      originalBytes: encoded.length,
    },
  }

  encoded = JSON.stringify(reducedPayload)
  if (typeof encoded !== "string" || encoded.length > MAX_PAYLOAD_BYTES) {
    return null
  }

  return encoded
}

async function dispatchPayload(payloadJson) {
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const blob = new Blob([payloadJson], { type: "application/json" })
      if (navigator.sendBeacon(TELEMETRY_ENDPOINT, blob)) {
        return true
      }
    } catch {
      // Ignore and fallback to fetch.
    }
  }

  try {
    const response = await fetch(TELEMETRY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payloadJson,
      keepalive: true,
    })

    return response.ok
  } catch {
    return false
  }
}

export function errorToContext(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: truncateString(error.message, 600),
      stack: truncateStack(error.stack),
    }
  }

  if (typeof error === "string") {
    return { message: truncateString(error, 600) }
  }

  if (error && typeof error === "object") {
    return sanitizeForJson(error)
  }

  return { message: "Unknown error" }
}

export async function sendFrontendTelemetryEvent(input) {
  if (typeof window === "undefined" || !input) {
    return false
  }

  if (isRateLimited()) {
    return false
  }

  const payload = {
    level: normalizeLevel(input.level),
    event: String(input.event || "frontend.unknown").trim() || "frontend.unknown",
    message: truncateString(String(input.message || "Frontend telemetry event"), 600),
    context: sanitizeForJson(input.context || {}),
  }

  if (typeof payload.context.stack === "string") {
    payload.context.stack = truncateStack(payload.context.stack)
  }

  const payloadJson = buildPayloadJson(payload)
  if (!payloadJson) {
    return false
  }

  return dispatchPayload(payloadJson)
}

export function installFrontendTelemetryHandlers() {
  if (handlersInstalled || typeof window === "undefined") {
    return
  }

  handlersInstalled = true

  window.addEventListener("error", (event) => {
    const errorContext = errorToContext(event.error || event.message)
    void sendFrontendTelemetryEvent({
      level: "error",
      event: "frontend.ui_exception",
      message: event.message || "Unhandled window error",
      context: {
        ...errorContext,
        filename: event.filename || null,
        lineno: event.lineno || null,
        colno: event.colno || null,
        url: window.location.href,
        userAgent: navigator.userAgent,
      },
    })
  })

  window.addEventListener("unhandledrejection", (event) => {
    const reasonContext = errorToContext(event.reason)
    void sendFrontendTelemetryEvent({
      level: "error",
      event: "frontend.unhandled_rejection",
      message: reasonContext.message || "Unhandled promise rejection",
      context: {
        ...reasonContext,
        url: window.location.href,
        userAgent: navigator.userAgent,
      },
    })
  })
}

