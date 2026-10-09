/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { BrandLogo } from "@plane/ui";

export function LogoSpinner() {
  return (
    <div role="status" aria-label="در حال بارگذاری" className="flex items-center justify-center">
      <BrandLogo decorative className="h-6 w-auto object-contain motion-safe:animate-pulse sm:h-11" />
    </div>
  );
}
