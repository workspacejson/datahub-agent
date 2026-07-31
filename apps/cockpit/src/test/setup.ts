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

// jsdom does not implement ResizeObserver. Radix UI's popover uses it
// internally for collision detection and content sizing.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
