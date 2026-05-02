/**
 * AES-256-CBC Verschluesselung fuer sicheren API-Key Transport
 * Muss mit dem Backend-Algorithmus uebereinstimmen
 */

const ENCRYPTION_KEY = import.meta.env.VITE_ENCRYPTION_KEY || '';

/**
 * Konvertiert einen String zu einem Uint8Array
 */
function stringToBytes(str) {
  return new TextEncoder().encode(str);
}

/**
 * Konvertiert einen Uint8Array zu Base64
 */
function bytesToBase64(bytes) {
  const binString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binString);
}

/**
 * Erzeugt einen 32-Byte Key aus dem konfigurierten Secret
 */
function getKey() {
  const keyString = ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32);
  return stringToBytes(keyString);
}

/**
 * Verschluesselt plaintext mit AES-256-CBC
 * Format: base64(iv + ciphertext)
 */
export async function encrypt(plaintext) {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error('Encryption key not configured. Set VITE_ENCRYPTION_KEY in .env (min 32 chars)');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    getKey(),
    { name: 'AES-CBC', length: 256 },
    false,
    ['encrypt']
  );

  // Generiere 16-Byte IV
  const iv = crypto.getRandomValues(new Uint8Array(16));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    key,
    stringToBytes(plaintext)
  );

  // Kombiniere IV + Ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return bytesToBase64(combined);
}

/**
 * Prueft ob die Verschluesselung konfiguriert ist
 */
export function isEncryptionConfigured() {
  return ENCRYPTION_KEY && ENCRYPTION_KEY.length >= 32 && !ENCRYPTION_KEY.startsWith('change-this');
}
