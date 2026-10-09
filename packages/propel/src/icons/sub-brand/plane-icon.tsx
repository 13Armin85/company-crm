/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ISvgIcons } from "../type";
import { AmardLogo } from "../brand/amard-logo";

export function PlaneNewIcon(props: ISvgIcons) {
  return <AmardLogo width={16} height={16} {...props} />;
}
