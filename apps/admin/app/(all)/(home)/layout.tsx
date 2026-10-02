/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { useRouter } from "next/navigation";
import { Outlet } from "react-router";
// hooks
import { useUser } from "@/hooks/store/use-user";

function RootLayout() {
  // router
  const { replace } = useRouter();
  // store hooks
  const { isUserLoggedIn } = useUser();

  useEffect(() => {
    if (isUserLoggedIn === true) replace("/general");
  }, [replace, isUserLoggedIn]);

  return (
    <div className="admin-auth">
      <section className="admin-auth-showcase" aria-label="هم‌کار">
        <div className="admin-brand">
          <span className="admin-brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <strong>هم‌کار</strong>
        </div>
        <span className="admin-auth-badge">پنل مدیریت سامانه · God mode</span>
        <h1>
          همه‌چیز برای یک
          <br />
          تیم هماهنگ.
        </h1>
        <p>فضاهای کاری، دسترسی‌ها و تنظیمات را از یک جا مدیریت کنید؛ با همان تجربهٔ ساده و آشنای هم‌کار.</p>
      </section>
      <div className="admin-auth-form-side">
        <Outlet />
      </div>
    </div>
  );
}

export default observer(RootLayout);
