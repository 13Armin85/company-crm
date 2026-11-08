import { ErrorState } from "../error-state";
import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useAccess } from "./api";
import { errorMessage } from "../api";
import { usePermission } from "./use-permission";

export function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return usePermission(permission) ? children : fallback;
}

export function PermissionRoute({ permission, children }: { permission: string; children: ReactNode }) {
  const { data, isLoading, error } = useAccess();
  if (error)
    return <ErrorState message={errorMessage(error, "بررسی دسترسی‌های شما برای باز کردن این صفحه انجام نشد")} />;
  if (isLoading || !data)
    return (
      <div role="status" className="access-loading">
        در حال بررسی دسترسی…
      </div>
    );
  return data.can(permission) ? children : <Navigate to="/my-work" replace />;
}
