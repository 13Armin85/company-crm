/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */
import Link from "next/link";
import { WEB_BASE_URL } from "@plane/constants";
export function AuthHeader() {
  return (
    <div className="admin-auth-header">
      <Link href="/" className="font-semibold text-primary">
        مدیریت هم‌کار
      </Link>
      <a href={WEB_BASE_URL + "/"}>بازگشت به برنامه ←</a>
    </div>
  );
}
