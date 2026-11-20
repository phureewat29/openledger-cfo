/** The OpenLedger mark, inlined so it takes the current text color. */
export function OlLogo({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      aria-hidden
      className={className}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M86 66a62 62 0 1 0 0 124 62 62 0 1 0 0-124Zm0 36a26 26 0 1 1 0 52 26 26 0 1 1 0-52ZM168 66h36v88h36v36h-72V66Z"
      />
    </svg>
  );
}
