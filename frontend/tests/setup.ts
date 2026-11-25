import "@testing-library/jest-dom/vitest";

if (typeof HTMLMediaElement !== "undefined") {
  HTMLMediaElement.prototype.pause = () => undefined;
  HTMLMediaElement.prototype.load = () => undefined;
}

if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}

if (typeof URL !== "undefined") {
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = () => "blob:safedeal/mock";
  }
  if (typeof URL.revokeObjectURL !== "function") {
    URL.revokeObjectURL = () => undefined;
  }
}
