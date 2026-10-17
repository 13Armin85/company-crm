import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useAccess } from "./api";
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
  if (error) return <p role="alert">عملیات انجام نشد؛ اطلاعات واردشده را بررسی و دوباره تلاش کنید.</p>;
  if (isLoading || !data)
    return (
      <div role="status" className="access-loading">
        در حال بررسی دسترسی…
      </div>
    );
  return data.can(permission) ? children : <Navigate to="/my-work" replace />;
}
