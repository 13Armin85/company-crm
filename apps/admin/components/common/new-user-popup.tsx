/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
// ui
import { Button } from "@makeplane/propel/components/button";
import { BrandLogo } from "@plane/ui";
// hooks
import { useTheme } from "@/hooks/store";
// icons

export const NewUserPopup = observer(function NewUserPopup() {
  // hooks
  const { isNewUserPopup, toggleNewUserPopup } = useTheme();

  if (!isNewUserPopup) return <></>;
  return (
    <div className="shadow-md absolute end-8 bottom-8 w-96 rounded-lg border border-subtle bg-surface-1 p-6">
      <div className="flex gap-4">
        <div className="grow">
          <div className="text-14 font-semibold">Create workspace</div>
          <div className="py-2 text-13 font-medium text-tertiary">
            Instance setup done! Welcome to Plane instance portal. Start your journey with by creating your first
            workspace.
          </div>
          <div className="flex items-center gap-4 pt-2">
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              nativeButton={false}
              render={<Link href="/workspace/create" />}
              label="Create workspace"
            />
            <Button variant="secondary" size="md" stretch="auto" onClick={toggleNewUserPopup} label="Close" />
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-center">
          <BrandLogo height={80} width={80} className="object-contain" />
        </div>
      </div>
    </div>
  );
});
