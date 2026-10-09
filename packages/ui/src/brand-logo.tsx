import type { ImgHTMLAttributes } from "react";
import { COMPANY_LOGO_ALT, COMPANY_LOGO_FULL, COMPANY_LOGO_SYMBOL } from "@plane/constants";

export type BrandLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  variant?: "symbol" | "full";
  decorative?: boolean;
};

export function BrandLogo({
  variant = "symbol",
  decorative = false,
  alt = COMPANY_LOGO_ALT,
  ...props
}: BrandLogoProps) {
  return (
    <img
      width={variant === "full" ? 240 : 48}
      height={variant === "full" ? 160 : 32}
      decoding="async"
      draggable={false}
      {...props}
      src={variant === "full" ? COMPANY_LOGO_FULL : COMPANY_LOGO_SYMBOL}
      alt={decorative ? "" : alt}
      aria-hidden={decorative || undefined}
      data-company-logo={variant}
    />
  );
}
