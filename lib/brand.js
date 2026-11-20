// Brand configuration. Everything customer-facing that names the brand reads it from here.
// Set BRAND_NAME  in the environment; the default is neutral.
export const DEFAULT_BRAND = 'DTC Portal';
export function brandName(env = process.env) {
  const value = String(env?.BRAND_NAME || '').replace(/[\u0000-\u001f<>&"']/g, '').trim().slice(0, 60);
  return value || DEFAULT_BRAND;
}
// Hostnames (comma-separated, no scheme) whose landing pages the portal may fetch for automated review.
export function landingHosts(env = process.env) {
  return String(env?.LANDING_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
}
