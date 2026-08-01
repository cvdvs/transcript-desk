// The mark: a dot. Recolors via currentColor.
export default function Logo({ size = 22, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <circle cx="50" cy="50" r="34" fill="currentColor" />
    </svg>
  );
}
