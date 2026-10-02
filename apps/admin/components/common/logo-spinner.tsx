/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export function LogoSpinner() {
  return (
    <div role="status" aria-label="در حال بارگذاری" className="flex items-center justify-center">
      <span className="admin-brand-mark motion-safe:animate-pulse" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
