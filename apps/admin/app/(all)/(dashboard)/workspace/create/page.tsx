/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// components
import { PageWrapper } from "@/components/common/page-wrapper";
// types
import type { Route } from "./+types/page";
// local
import { WorkspaceCreateForm } from "./form";

const WorkspaceCreatePage = observer(function WorkspaceCreatePage(_props: Route.ComponentProps) {
  return (
    <PageWrapper
      header={{
        title: "ایجاد فضای کاری",
        description: "پس از ایجاد فضای کاری، اعضای تیم را از بخش تنظیمات دعوت کنید.",
      }}
    >
      <WorkspaceCreateForm />
    </PageWrapper>
  );
});

export const meta: Route.MetaFunction = () => [{ title: "Create Workspace - God Mode" }];

export default WorkspaceCreatePage;
