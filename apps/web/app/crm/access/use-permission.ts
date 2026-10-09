import { useAccess } from "./api";

export const permissionGranted = (permissions: readonly string[] | undefined, code: string) =>
  permissions?.includes(code) ?? false;
export const usePermission = (code: string) => permissionGranted(useAccess().data?.permissions, code);
export const useAnyPermission = (codes: readonly string[]) => {
  const permissions = useAccess().data?.permissions;
  return codes.some((code) => permissionGranted(permissions, code));
};
export const useAllPermissions = (codes: readonly string[]) => {
  const permissions = useAccess().data?.permissions;
  return codes.every((code) => permissionGranted(permissions, code));
};
