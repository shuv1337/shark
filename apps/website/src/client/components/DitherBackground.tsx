import { useEffect, useRef } from "react";

/** 8×8 Bayer threshold matrix for ordered dithering. */
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7,
  39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];
const BASE = [2, 63, 51] as const;
const LIGHT = [3, 80, 65] as const;
const DEEP = [1, 46, 37] as const;
/** CSS pixels per dither cell; the canvas is scaled up with `pixelated`. */
const CELL = 3;

function draw(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = Math.ceil(window.innerWidth / CELL);
  const h = Math.ceil(window.innerHeight / CELL);
  canvas.width = w;
  canvas.height = h;
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / w;
      const ny = y / h;
      // A soft glow from the top left and shade towards the bottom right.
      const glow = Math.max(0, 1 - Math.hypot(nx - 0.08, ny + 0.05) / 0.95);
      const shade = Math.max(0, 1 - Math.hypot(nx - 1, ny - 1.05) / 0.9);
      const t = ((BAYER[(y % 8) * 8 + (x % 8)] ?? 0) + 0.5) / 64;
      const c = glow * 0.45 > t ? LIGHT : shade * 0.4 > t ? DEEP : BASE;
      const i = (y * w + x) * 4;
      image.data[i] = c[0];
      image.data[i + 1] = c[1];
      image.data[i + 2] = c[2];
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * The site-wide backdrop: Hark green, ordered-dithered into a lighter glow at
 * the top left and a deeper shade at the bottom right. Static, so it never
 * competes with content; it only redraws when the viewport size changes.
 */
export function DitherBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    draw(canvas);
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => draw(canvas));
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div aria-hidden="true">
      <canvas className="hark-dither" ref={ref} />
    </div>
  );
}
