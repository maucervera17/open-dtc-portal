// Single source of truth for the shell breakpoint. The stylesheet mirrors it by hand (CSS cannot import): the sidebar shows
// from DESKTOP_MIN up, and below it (MOBILE_MAX and down) the sidebar is an off-canvas drawer behind the hamburger.
// A test keeps styles.css and this file in agreement.
export const DESKTOP_MIN = 1024;
export const MOBILE_MAX = DESKTOP_MIN - 1;
export const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN}px)`;

// Phones: below 768px. The stylesheet's mobile block mirrors it; charts read it to thin their ticks and drop the legend.
export const PHONE_MAX = 767;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX}px)`;
export const isPhone = () => { try { return globalThis.matchMedia ? globalThis.matchMedia(PHONE_QUERY).matches : false; } catch { return false; } };
