/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export function FormHeader({ heading, subHeading }: { heading: string; subHeading: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-20 leading-7 font-semibold text-primary">{heading}</span>
      <span className="text-13 leading-7 text-secondary">{subHeading}</span>
    </div>
  );
}
