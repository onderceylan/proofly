/**
 * Platform detection utilities using modern User-Agent Client Hints API
 * @see https://developer.mozilla.org/en-US/docs/Web/API/User-Agent_Client_Hints_API
 */

/**
 * Detects if the current platform is macOS using the modern User-Agent Client Hints API.
 * This is a synchronous check that works for Chrome/Edge 90+ (Chromium-based browsers).
 *
 * @returns true if the platform is macOS, false otherwise
 */
export function isMacOS(): boolean {
  if ('userAgentData' in navigator && navigator.userAgentData) {
    return navigator.userAgentData.platform.toLowerCase() === 'macos';
  }

  return false;
}

/**
 * Gets the platform name using the modern User-Agent Client Hints API.
 *
 * @returns The platform name in lowercase (e.g., 'macos', 'windows', 'linux')
 */
export function getPlatform(): string {
  if ('userAgentData' in navigator && navigator.userAgentData) {
    return navigator.userAgentData.platform.toLowerCase();
  }

  return 'unknown';
}
