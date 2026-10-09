import { COMPANY_LOGO_ALT, COMPANY_LOGO_SYMBOL } from "@plane/constants";
import type { ISvgIcons } from "../type";

/** Keep the SVG icon interface for existing brand consumers. */
export function AmardLogo({ width = 85, height = 52, ...props }: ISvgIcons) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 256 171"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={COMPANY_LOGO_ALT}
      data-company-logo="symbol"
      {...props}
    >
      <image href={COMPANY_LOGO_SYMBOL} width="256" height="171" preserveAspectRatio="xMidYMid meet" />
    </svg>
  );
}
