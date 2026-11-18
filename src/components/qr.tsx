import { encode } from "uqr";

/** QR code as SVG rects (no canvas, no innerHTML). */
export function QrCode({ value, className }: { value: string; className?: string }) {
  const { data, size } = encode(value, { ecc: "M", border: 2 });
  const path: string[] = [];
  data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) path.push(`M${x} ${y}h1v1h-1z`);
    }),
  );
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} shapeRendering="crispEdges" role="img" aria-label="QR code">
      <rect width={size} height={size} fill="#fff" />
      <path d={path.join("")} fill="#000" />
    </svg>
  );
}
