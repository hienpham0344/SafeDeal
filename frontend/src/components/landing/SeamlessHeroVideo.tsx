import { useEffect, useLayoutEffect, useRef } from "react";

export interface SeamlessHeroVideoProps {
  readonly src: string;
  readonly crossfadeSeconds?: number;
}

const DEFAULT_CROSSFADE_SECONDS = 1.8;
const CUSHION_SECONDS = 1.45;
const MAX_OVERLAP_RATIO = 0.3;
const MIN_DURATION_FOR_CROSSFADE = 2.4;
const MIN_CAPTURED_FRAMES = 12;
const MAX_CAPTURE_WIDTH = 1280;
const HANDOFF_BLEND_MS = 180;
const INITIAL_SEEK_LEAD_SECONDS = 0.65;
const MIN_SEEK_LEAD_SECONDS = 0.15;
const MAX_SEEK_LEAD_SECONDS = 1.05;
const FRAME_CAPTURE_QUALITY = 0.86;
const BITMAP_PREFETCH_AHEAD = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface CapturedFrame {
  readonly t: number;
  readonly blob: Blob;
}

type PlaybackPhase = "native" | "crossfade" | "cushion" | "handoff-blend";

const blobUrlCache = new Map<string, string>();
const pendingBlobFetches = new Map<string, Promise<string | null>>();

function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  if (span <= 0) return 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / span));
  return t * t * (3 - 2 * t);
}

function getOrFetchHeroVideoBlob(src: string): Promise<string | null> {
  const existing = blobUrlCache.get(src);
  if (existing) {
    return Promise.resolve(existing);
  }
  const inFlight = pendingBlobFetches.get(src);
  if (inFlight) {
    return inFlight;
  }
  if (
    typeof window === "undefined" ||
    typeof fetch !== "function" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return Promise.resolve(null);
  }

  const fetchPromise = fetch(src, { mode: "cors" })
    .then(async (response) => {
      if (!response.ok) return null;
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType && !contentType.toLowerCase().startsWith("video/")) {
        return null;
      }
      const blob = await response.blob();
      if (!blob || blob.size === 0) return null;
      const objectUrl = URL.createObjectURL(blob);
      blobUrlCache.set(src, objectUrl);
      return objectUrl;
    })
    .catch(() => null)
    .finally(() => {
      pendingBlobFetches.delete(src);
    });

  pendingBlobFetches.set(src, fetchPromise);
  return fetchPromise;
}

function drawObjectCover70(
  ctx: CanvasRenderingContext2D,
  source: HTMLVideoElement | ImageBitmap,
  targetW: number,
  targetH: number
) {
  const srcW = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const srcH = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!srcW || !srcH || !targetW || !targetH) return;

  const scale = Math.max(targetW / srcW, targetH / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  const dx = (targetW - drawW) * 0.7;
  const dy = (targetH - drawH) * 0.5;
  ctx.drawImage(source, dx, dy, drawW, drawH);
}

function findNearestFrameIndex(frames: readonly CapturedFrame[], targetTime: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = frames[mid];
    if (candidate && candidate.t <= targetTime) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

function encodeCaptureSurface(
  surface: OffscreenCanvas | HTMLCanvasElement
): Promise<Blob | null> {
  if ("convertToBlob" in surface && typeof surface.convertToBlob === "function") {
    return surface
      .convertToBlob({ type: "image/jpeg", quality: FRAME_CAPTURE_QUALITY })
      .catch(() => null);
  }
  if ("toBlob" in surface && typeof surface.toBlob === "function") {
    return new Promise((resolve) => {
      try {
        surface.toBlob((blob) => resolve(blob), "image/jpeg", FRAME_CAPTURE_QUALITY);
      } catch {
        resolve(null);
      }
    });
  }
  return Promise.resolve(null);
}

export function SeamlessHeroVideo({
  src,
  crossfadeSeconds = DEFAULT_CROSSFADE_SECONDS,
}: SeamlessHeroVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.opacity = "0";
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    const cachedBlob = blobUrlCache.get(src) ?? null;
    if (cachedBlob && video.getAttribute("src") !== cachedBlob) {
      video.src = cachedBlob;
    } else if (!cachedBlob && video.getAttribute("src") !== src) {
      video.src = src;
    }

    let disposed = false;
    let resolvedBlobUrl: string | null = cachedBlob;
    let blobRequested = Boolean(cachedBlob);
    let captureComplete = false;
    let captureDisabled = !ctx || typeof createImageBitmap !== "function";
    let pendingEncodes = 0;
    let lastCapturedTime = -1;
    let captureWidth = 0;
    let captureHeight = 0;
    let captureSurface: OffscreenCanvas | HTMLCanvasElement | null = null;
    let captureCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
    let captureCallbackId: number | null = null;
    let rafId: number | null = null;

    let phase: PlaybackPhase = "native";
    let fadeStartTime = 0;
    let cushionCursorTime = 0;
    let lastCushionTickMs = 0;
    let handoffStartMs = 0;
    let observedSeekLeadSec = INITIAL_SEEK_LEAD_SECONDS;
    let seekMeasureStartMs = 0;
    let swapInFlight = false;

    const frames: CapturedFrame[] = [];
    const decodedBitmaps = new Map<number, ImageBitmap>();
    const decodingIndices = new Set<number>();

    const safePlay = () => {
      try {
        const res = video.play();
        if (res && typeof res.catch === "function") {
          return res.catch(() => undefined);
        }
      } catch {
        // Autoplay may be unavailable in test environments (e.g. jsdom).
      }
      return Promise.resolve();
    };

    const syncCanvasDimensions = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const nextW = Math.max(1, Math.round(rect.width * dpr));
      const nextH = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW;
        canvas.height = nextH;
      }
    };

    const releaseDecodedBitmaps = () => {
      for (const bitmap of decodedBitmaps.values()) {
        bitmap.close();
      }
      decodedBitmaps.clear();
      decodingIndices.clear();
    };

    const evictOldBitmaps = (minKeepIdx: number) => {
      for (const [idx, bitmap] of decodedBitmaps.entries()) {
        if (idx < minKeepIdx) {
          bitmap.close();
          decodedBitmaps.delete(idx);
        }
      }
    };

    const ensureBitmapWindow = (centerIdx: number) => {
      if (captureDisabled || frames.length === 0) return;
      const maxIdx = Math.min(frames.length - 1, centerIdx + BITMAP_PREFETCH_AHEAD);
      for (let i = Math.max(0, centerIdx); i <= maxIdx; i += 1) {
        if (decodedBitmaps.has(i) || decodingIndices.has(i)) continue;
        const frame = frames[i];
        if (!frame) continue;
        decodingIndices.add(i);
        void createImageBitmap(frame.blob)
          .then((bmp) => {
            decodingIndices.delete(i);
            if (disposed || phase === "native") {
              bmp.close();
              return;
            }
            decodedBitmaps.set(i, bmp);
          })
          .catch(() => {
            decodingIndices.delete(i);
          });
      }
    };

    const getAvailableBitmap = (targetIdx: number): ImageBitmap | undefined => {
      const exact = decodedBitmaps.get(targetIdx);
      if (exact) return exact;
      for (let i = targetIdx - 1; i >= Math.max(0, targetIdx - 4); i -= 1) {
        const fallback = decodedBitmaps.get(i);
        if (fallback) return fallback;
      }
      return undefined;
    };

    const startBackgroundBlobWarmup = () => {
      if (blobRequested || disposed) return;
      blobRequested = true;
      void getOrFetchHeroVideoBlob(src).then((blobUrl) => {
        if (!disposed && blobUrl) {
          resolvedBlobUrl = blobUrl;
        }
      });
    };

    const initCaptureSurface = (): boolean => {
      if (captureSurface && captureCtx) return true;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return false;

      const scale = Math.min(1, MAX_CAPTURE_WIDTH / vw);
      captureWidth = Math.max(1, Math.round(vw * scale));
      captureHeight = Math.max(1, Math.round(vh * scale));

      if (typeof OffscreenCanvas !== "undefined") {
        captureSurface = new OffscreenCanvas(captureWidth, captureHeight);
        captureCtx = captureSurface.getContext("2d");
      } else {
        const el = document.createElement("canvas");
        el.width = captureWidth;
        el.height = captureHeight;
        captureSurface = el;
        captureCtx = el.getContext("2d");
      }
      return Boolean(captureCtx);
    };

    const getCaptureTargetEnd = (duration: number): number => {
      const overlap = Math.min(crossfadeSeconds, duration * MAX_OVERLAP_RATIO);
      return Math.min(duration - 0.5, overlap + CUSHION_SECONDS);
    };

    const finishCapture = () => {
      captureComplete = true;
      frames.sort((a, b) => a.t - b.t);
      captureSurface = null;
      captureCtx = null;
      startBackgroundBlobWarmup();
    };

    const onVideoFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      if (disposed || captureDisabled || captureComplete) return;

      const duration = video.duration;
      if (!Number.isFinite(duration) || duration < MIN_DURATION_FOR_CROSSFADE) {
        captureCallbackId = video.requestVideoFrameCallback(onVideoFrame);
        return;
      }

      const targetEnd = getCaptureTargetEnd(duration);
      const mediaTime = meta.mediaTime;

      if (mediaTime > targetEnd + 0.08 && frames.length >= MIN_CAPTURED_FRAMES) {
        finishCapture();
        return;
      }

      if (
        mediaTime <= targetEnd + 0.08 &&
        mediaTime > lastCapturedTime + 0.015 &&
        pendingEncodes < 4 &&
        initCaptureSurface() &&
        captureSurface &&
        captureCtx
      ) {
        try {
          captureCtx.drawImage(video, 0, 0, captureWidth, captureHeight);
          lastCapturedTime = mediaTime;
          pendingEncodes += 1;
          void encodeCaptureSurface(captureSurface).then((blob) => {
            pendingEncodes -= 1;
            if (!disposed && blob && !captureComplete) {
              frames.push({ t: mediaTime, blob });
            }
          });
        } catch {
          // Cross-origin canvas taint or security restriction: gracefully fall back to direct playback.
          captureDisabled = true;
          captureSurface = null;
          captureCtx = null;
          return;
        }
      }

      captureCallbackId = video.requestVideoFrameCallback(onVideoFrame);
    };

    const supportsRvfc = typeof video.requestVideoFrameCallback === "function";
    if (!supportsRvfc) {
      captureDisabled = true;
    } else if (!captureDisabled) {
      captureCallbackId = video.requestVideoFrameCallback(onVideoFrame);
    }

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (!disposed && phase === "native") {
              syncCanvasDimensions();
            }
          })
        : null;
    resizeObserver?.observe(canvas);
    syncCanvasDimensions();

    const triggerSeekForCushion = (maxSeekTime: number) => {
      seekMeasureStartMs = performance.now();

      const applySeekAndPlay = () => {
        if (disposed) return;
        const targetSeekTime = clamp(
          cushionCursorTime + observedSeekLeadSec,
          cushionCursorTime + 0.12,
          Math.max(0.2, maxSeekTime)
        );
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          if (seekMeasureStartMs > 0) {
            const measuredSec = clamp(
              (performance.now() - seekMeasureStartMs) / 1000,
              MIN_SEEK_LEAD_SECONDS,
              MAX_SEEK_LEAD_SECONDS
            );
            observedSeekLeadSec = observedSeekLeadSec * 0.4 + measuredSec * 0.6;
          }
        };
        video.addEventListener("seeked", onSeeked);
        video.playbackRate = 1;
        video.currentTime = targetSeekTime;
        void safePlay();
        swapInFlight = false;
      };

      if (resolvedBlobUrl && video.getAttribute("src") !== resolvedBlobUrl) {
        swapInFlight = true;
        const cleanupSwapListeners = () => {
          video.removeEventListener("loadedmetadata", onMeta);
          video.removeEventListener("error", onSwapError);
        };
        const onMeta = () => {
          cleanupSwapListeners();
          applySeekAndPlay();
        };
        const onSwapError = () => {
          cleanupSwapListeners();
          swapInFlight = false;
          video.src = src;
          video.load();
        };
        video.addEventListener("loadedmetadata", onMeta);
        video.addEventListener("error", onSwapError);
        video.src = resolvedBlobUrl;
        video.load();
      } else {
        applySeekAndPlay();
      }
    };

    const tick = () => {
      if (disposed) return;

      const duration = video.duration;
      const canBlend =
        !captureDisabled &&
        ctx !== null &&
        captureComplete &&
        frames.length >= MIN_CAPTURED_FRAMES &&
        Number.isFinite(duration) &&
        duration >= MIN_DURATION_FOR_CROSSFADE;

      if (canBlend) {
        const overlap = Math.min(crossfadeSeconds, duration * MAX_OVERLAP_RATIO);
        const fadeStart = duration - overlap;
        const remaining = duration - video.currentTime;
        const cw = canvas.width;
        const ch = canvas.height;
        const lastFrameTime = frames[frames.length - 1]?.t ?? overlap;

        if (phase === "native") {
          if (remaining <= overlap + 0.5 && remaining > overlap) {
            ensureBitmapWindow(0);
          }

          if (remaining <= overlap && remaining > 0) {
            syncCanvasDimensions();
            fadeStartTime = fadeStart;
            phase = "crossfade";
            ensureBitmapWindow(0);
            ctx.globalAlpha = 1;
            drawObjectCover70(ctx, video, canvas.width, canvas.height);
            canvas.style.opacity = "1";
          }
        } else if (phase === "crossfade") {
          const inTime = Math.max(0, video.currentTime - fadeStartTime);
          const idx = findNearestFrameIndex(frames, inTime);
          ensureBitmapWindow(idx);
          evictOldBitmaps(idx - 2);
          const bmp = getAvailableBitmap(idx);

          ctx.globalAlpha = 1;
          drawObjectCover70(ctx, video, cw, ch);
          if (bmp) {
            ctx.globalAlpha = smoothstep(0, overlap, inTime);
            drawObjectCover70(ctx, bmp, cw, ch);
          }
          ctx.globalAlpha = 1;

          if (video.currentTime >= duration - 0.045 || video.ended) {
            phase = "cushion";
            cushionCursorTime = Math.min(inTime, overlap);
            lastCushionTickMs = performance.now();
            triggerSeekForCushion(lastFrameTime - 0.35);
          }
        } else if (phase === "cushion") {
          const nowMs = performance.now();
          const dtSec = Math.min(0.1, Math.max(0, (nowMs - lastCushionTickMs) / 1000));
          lastCushionTickMs = nowMs;

          if (!swapInFlight && !video.seeking && video.paused) {
            void safePlay();
          }

          const videoReadyToTakeOver =
            !swapInFlight &&
            !video.seeking &&
            video.readyState >= 3 &&
            !video.paused &&
            video.currentTime >= cushionCursorTime - 0.5 &&
            video.currentTime < fadeStart;

          let cursorSpeed = 1;
          if (videoReadyToTakeOver) {
            const delta = video.currentTime - cushionCursorTime;
            if (delta > 0.08) {
              cursorSpeed = 1.2;
              video.playbackRate = 0.8;
            } else if (delta < -0.08) {
              cursorSpeed = 0.85;
              video.playbackRate = 1.25;
            } else {
              video.playbackRate = 1;
            }
          } else {
            video.playbackRate = 1;
          }

          cushionCursorTime = Math.min(lastFrameTime, cushionCursorTime + dtSec * cursorSpeed);
          const idx = findNearestFrameIndex(frames, cushionCursorTime);
          ensureBitmapWindow(idx);
          evictOldBitmaps(idx - 2);
          const bmp = getAvailableBitmap(idx);

          if (bmp) {
            ctx.globalAlpha = 1;
            drawObjectCover70(ctx, bmp, cw, ch);
          }

          const caughtUp =
            videoReadyToTakeOver &&
            (Math.abs(video.currentTime - cushionCursorTime) <= 0.08 ||
              cushionCursorTime >= lastFrameTime - 0.02);

          if (caughtUp) {
            video.playbackRate = 1;
            phase = "handoff-blend";
            handoffStartMs = nowMs;
          }
        } else if (phase === "handoff-blend") {
          const nowMs = performance.now();
          const dtSec = Math.min(0.1, Math.max(0, (nowMs - lastCushionTickMs) / 1000));
          lastCushionTickMs = nowMs;
          cushionCursorTime = Math.min(lastFrameTime, cushionCursorTime + dtSec);

          const blendProgress = Math.min(1, (nowMs - handoffStartMs) / HANDOFF_BLEND_MS);
          const idx = findNearestFrameIndex(frames, cushionCursorTime);
          const bmp = getAvailableBitmap(idx);

          ctx.globalAlpha = 1;
          drawObjectCover70(ctx, video, cw, ch);
          if (bmp && blendProgress < 1) {
            ctx.globalAlpha = 1 - smoothstep(0, 1, blendProgress);
            drawObjectCover70(ctx, bmp, cw, ch);
          }
          ctx.globalAlpha = 1;

          if (blendProgress >= 1) {
            video.playbackRate = 1;
            canvas.style.opacity = "0";
            ctx.clearRect(0, 0, cw, ch);
            releaseDecodedBitmaps();
            phase = "native";
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    const handleEnded = () => {
      if (disposed) return;
      if (phase === "native") {
        if (!captureComplete && frames.length >= MIN_CAPTURED_FRAMES) {
          finishCapture();
        }
        if (resolvedBlobUrl && video.getAttribute("src") !== resolvedBlobUrl) {
          const onMeta = () => {
            video.removeEventListener("loadedmetadata", onMeta);
            video.currentTime = 0;
            void safePlay();
          };
          video.addEventListener("loadedmetadata", onMeta);
          video.src = resolvedBlobUrl;
          video.load();
        } else {
          video.currentTime = 0;
          void safePlay();
        }
      }
    };

    const handleVisibilityChange = () => {
      if (disposed || document.hidden) return;
      video.playbackRate = 1;
      if (phase !== "native" && ctx) {
        canvas.style.opacity = "0";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        releaseDecodedBitmaps();
        phase = "native";
      }
      if (video.ended) {
        video.currentTime = 0;
      }
      if (video.paused) {
        void safePlay();
      }
    };

    const handleCanPlay = () => {
      if (disposed) return;
      if (phase === "native" && video.paused) {
        void safePlay();
      }
      if (captureDisabled) {
        startBackgroundBlobWarmup();
      }
    };

    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("ended", handleEnded);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    rafId = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      video.playbackRate = 1;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (captureCallbackId !== null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(captureCallbackId);
      }
      resizeObserver?.disconnect();
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("ended", handleEnded);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      releaseDecodedBitmaps();
      frames.length = 0;
      captureSurface = null;
      captureCtx = null;
    };
  }, [src, crossfadeSeconds]);

  return (
    <div
      aria-hidden="true"
      data-testid="seamless-hero-video"
      className="pointer-events-none absolute inset-0 z-0"
    >
      <video
        ref={videoRef}
        data-hero-video="primary"
        data-hero-src={src}
        autoPlay
        muted
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        src={src}
        className="absolute inset-0 h-full w-full object-cover object-[70%_center]"
        aria-hidden="true"
      />
      <canvas
        ref={canvasRef}
        data-hero-canvas="blend"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      />
    </div>
  );
}
