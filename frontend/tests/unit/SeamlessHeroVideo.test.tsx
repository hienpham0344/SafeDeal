import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SeamlessHeroVideo } from "@/components/landing/SeamlessHeroVideo";

const TEST_VIDEO_URL = "https://cdn.example.test/hero.mp4";

function createMockCanvasContext() {
  return {
    globalAlpha: 1,
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("SeamlessHeroVideo", () => {
  let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let nextRafId = 1;
  let nowMs = 1000;

  beforeEach(() => {
    rafQueue = [];
    nextRafId = 1;
    nowMs = 1000;

    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.push({ id, cb });
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafQueue = rafQueue.filter((item) => item.id !== id);
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline test")));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const flushFrame = (advanceMs = 16) => {
    nowMs += advanceMs;
    const batch = [...rafQueue];
    rafQueue = [];
    act(() => {
      for (const item of batch) {
        item.cb(nowMs);
      }
    });
  };

  it("renders a single video decoder and transparent blend canvas overlay", () => {
    const { container } = render(<SeamlessHeroVideo src={TEST_VIDEO_URL} />);
    const videos = container.querySelectorAll("video");
    const canvas = container.querySelector('canvas[data-hero-canvas="blend"]') as HTMLCanvasElement;

    expect(videos).toHaveLength(1);
    const primary = videos[0] as HTMLVideoElement;
    expect(primary.getAttribute("data-hero-video")).toBe("primary");
    expect(primary.getAttribute("data-hero-src")).toBe(TEST_VIDEO_URL);
    expect(primary.autoplay).toBe(true);
    expect(primary.muted).toBe(true);
    expect(primary.playsInline).toBe(true);
    expect(primary.className).toContain("object-cover");
    expect(primary.className).toContain("object-[70%_center]");
    expect(canvas).not.toBeNull();
    expect(canvas.style.opacity).toBe("0");
  });

  it("falls back to clean rewind on ended when frame capture is unavailable", () => {
    const { container } = render(<SeamlessHeroVideo src={TEST_VIDEO_URL} />);
    const video = container.querySelector('video[data-hero-video="primary"]') as HTMLVideoElement;
    const canvas = container.querySelector('canvas[data-hero-canvas="blend"]') as HTMLCanvasElement;

    const playMock = vi.fn().mockResolvedValue(undefined);
    video.play = playMock;
    Object.defineProperty(video, "duration", { configurable: true, value: 8.0 });
    Object.defineProperty(video, "readyState", { configurable: true, value: 4 });
    video.currentTime = 8.0;

    act(() => {
      video.dispatchEvent(new Event("ended"));
    });

    expect(video.currentTime).toBe(0);
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(canvas.style.opacity).toBe("0");
  });

  it("captures opening frames, crossfades across loop end, seeks during cushion, and hands back smoothly", async () => {
    const bitmapClosers: Array<ReturnType<typeof vi.fn>> = [];
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockImplementation(() => {
        const close = vi.fn();
        bitmapClosers.push(close);
        return Promise.resolve({ width: 1280, height: 720, close });
      })
    );

    const captureCtx = createMockCanvasContext();
    const displayCtx = createMockCanvasContext();

    class MockOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return captureCtx;
      }
      convertToBlob() {
        return Promise.resolve(new Blob(["jpeg"], { type: "image/jpeg" }));
      }
    }
    vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);

    const origGetContext = HTMLCanvasElement.prototype.getContext;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, kind: string) {
      if (kind === "2d") {
        return displayCtx;
      }
      return origGetContext.call(this, kind as never);
    });

    let rvfcCb: ((now: number, meta: VideoFrameCallbackMetadata) => void) | null = null;
    const origRvfc = HTMLVideoElement.prototype.requestVideoFrameCallback;
    const origCancelRvfc = HTMLVideoElement.prototype.cancelVideoFrameCallback;
    HTMLVideoElement.prototype.requestVideoFrameCallback = vi.fn((cb) => {
      rvfcCb = cb;
      return 101;
    });
    HTMLVideoElement.prototype.cancelVideoFrameCallback = vi.fn();

    try {
      const { container } = render(<SeamlessHeroVideo src={TEST_VIDEO_URL} crossfadeSeconds={1.8} />);
      const video = container.querySelector('video[data-hero-video="primary"]') as HTMLVideoElement;
      const canvas = container.querySelector('canvas[data-hero-canvas="blend"]') as HTMLCanvasElement;

      let pausedState = false;
      let seekingState = false;
      Object.defineProperty(video, "duration", { configurable: true, value: 8.0 });
      Object.defineProperty(video, "videoWidth", { configurable: true, value: 1920 });
      Object.defineProperty(video, "videoHeight", { configurable: true, value: 1080 });
      Object.defineProperty(video, "readyState", { configurable: true, value: 4 });
      Object.defineProperty(video, "paused", { configurable: true, get: () => pausedState });
      Object.defineProperty(video, "seeking", { configurable: true, get: () => seekingState });
      video.play = vi.fn().mockImplementation(() => {
        pausedState = false;
        return Promise.resolve();
      });

      // Feed 16 opening frames (0.04s .. 3.04s) plus sentinel beyond capture target
      for (let i = 0; i < 16; i += 1) {
        const mediaTime = Number((0.04 + i * 0.2).toFixed(2));
        await act(async () => {
          rvfcCb?.(nowMs, { mediaTime } as VideoFrameCallbackMetadata);
          await Promise.resolve();
        });
      }
      await act(async () => {
        rvfcCb?.(nowMs, { mediaTime: 3.6 } as VideoFrameCallbackMetadata);
        await Promise.resolve();
      });

      // Still native playback at 5.0s -> canvas hidden
      video.currentTime = 5.0;
      flushFrame(16);
      expect(canvas.style.opacity).toBe("0");

      // Enter crossfade window (8.0 - 6.4 = 1.6 <= 1.8)
      video.currentTime = 6.4;
      flushFrame(16);
      await act(async () => {
        await Promise.resolve();
      });
      expect(canvas.style.opacity).toBe("1");

      // Mid-crossfade tick renders both outgoing video and incoming bitmap
      video.currentTime = 7.1;
      flushFrame(16);
      await act(async () => {
        await Promise.resolve();
      });
      expect(displayCtx.drawImage).toHaveBeenCalled();

      // Reach clip end -> transition to cushion and trigger adaptive forward seek
      seekingState = true;
      video.currentTime = 7.98;
      flushFrame(16);
      expect(video.currentTime).toBeGreaterThanOrEqual(1.8);
      expect(video.currentTime).toBeLessThanOrEqual(3.0);

      // Simulate seek completing close to current cushion cursor (~2.45s) and playing at active playbackRate
      seekingState = false;
      video.currentTime = 2.45;
      act(() => {
        video.dispatchEvent(new Event("seeked"));
      });
      for (let step = 0; step < 60; step += 1) {
        flushFrame(32);
        if (canvas.style.opacity === "0") {
          break;
        }
        video.currentTime += 0.032 * video.playbackRate;
      }

      expect(canvas.style.opacity).toBe("0");
      expect(video.playbackRate).toBe(1);
      expect(bitmapClosers.some((fn) => fn.mock.calls.length > 0)).toBe(true);
    } finally {
      HTMLVideoElement.prototype.requestVideoFrameCallback = origRvfc;
      HTMLVideoElement.prototype.cancelVideoFrameCallback = origCancelRvfc;
    }
  });
});
