/**
 * Sherpa brand logo — angular two-peak mountain mark + letterspaced wordmark.
 * SVG recreation of the brand asset so it scales crisply everywhere; drop the
 * original file into public/ and swap here if pixel-perfect fidelity is needed.
 */

const MARK_VIEWBOX = "0 0 120 68";

function Mark({ color }: { color: string }) {
  return (
    <>
      {/* small peak */}
      <path
        d="M4 62 L36 22 L50 39"
        fill="none"
        stroke={color}
        strokeWidth={7}
        strokeMiterlimit={12}
      />
      {/* main peak */}
      <path
        d="M28 62 L70 8 L116 62"
        fill="none"
        stroke={color}
        strokeWidth={7}
        strokeMiterlimit={12}
      />
    </>
  );
}

interface LogoProps {
  /** mark = mountain only; full = mark above the SHERPA wordmark */
  variant?: "mark" | "full";
  /** brand navy by default; pass "#fff" on dark surfaces */
  color?: string;
  height?: number;
  className?: string;
}

export function Logo({ variant = "full", color = "var(--color-primary)", height = 56, className }: LogoProps) {
  if (variant === "mark") {
    return (
      <svg viewBox={MARK_VIEWBOX} height={height} className={className} role="img" aria-label="Sherpa">
        <Mark color={color} />
      </svg>
    );
  }
  return (
    <svg viewBox="-30 0 180 100" height={height} className={className} role="img" aria-label="Sherpa">
      <Mark color={color} />
      {/* letter-spacing adds a trailing gap after the last glyph — nudge x
          right of center so the wordmark reads visually centered */}
      <text
        x={64}
        y={92}
        textAnchor="middle"
        fill={color}
        style={{
          font: "600 21px var(--font-family)",
          letterSpacing: "0.42em",
        }}
      >
        SHERPA
      </text>
    </svg>
  );
}
