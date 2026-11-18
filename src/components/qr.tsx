import { encode } from "uqr";

/** QR code as SVG (no canvas, no innerHTML). */
export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const { data, size: n } = encode(value, { ecc: "M", border: 1 });
  const path: string[] = [];
  data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) path.push(`M${x} ${y}h1v1h-1z`);
    }),
  );
  return (
    <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label="QR code" style={{ display: "block" }}>
      <rect width={n} height={n} fill="#fff" />
      <path d={path.join("")} fill="#000" />
    </svg>
  );
}
