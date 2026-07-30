import "@testing-library/jest-dom/vitest";

// jsdom does not implement matchMedia. Motion's useReducedMotion hook calls it
// on mount, and without a mock the call hangs silently.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
}
