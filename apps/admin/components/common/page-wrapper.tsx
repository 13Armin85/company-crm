/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
// plane imports
import { cn } from "@plane/utils";

type TPageWrapperProps = {
  children: ReactNode;
  header?: {
    title: string;
    description: string | ReactNode;
    actions?: ReactNode;
  };
  customHeader?: ReactNode;
  size?: "lg" | "md";
};

export const PageWrapper = (props: TPageWrapperProps) => {
  const { children, header, customHeader, size = "md" } = props;

  return (
    <div
      className={cn("admin-page w-full", {
        "admin-page--wide": size === "lg",
      })}
    >
      {customHeader ? (
        <div className="admin-page-heading">{customHeader}</div>
      ) : (
        header && (
          <div className="admin-page-heading">
            <div className={header.actions ? "flex flex-col gap-1" : "space-y-1"}>
              <h1 className="text-primary">{header.title}</h1>
              <div className="admin-page-description">{header.description}</div>
            </div>
            {header.actions && <div className="shrink-0">{header.actions}</div>}
          </div>
        )
      )}
      <div className="admin-page-content">{children}</div>
    </div>
  );
};
