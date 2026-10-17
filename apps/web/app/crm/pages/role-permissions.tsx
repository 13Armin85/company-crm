import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { CompactMultiSelector } from "@plane/ui";
import {
  useOrganizationPermissions,
  useOrganizationRole,
  useSaveOrganizationRole,
  useWorkspaceAccess,
  errorMessage,
} from "../api";
import { Button, PageHeader, Skeleton } from "../components";
import { permissionPresentation } from "../access/permission-labels";
import { useUIStore } from "../store";

export default function RolePermissionsPage() {
  const { roleId = "" } = useParams();
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const {
    data: role,
    isLoading,
    error,
  } = useOrganizationRole(roleId, Boolean(access?.can("Role.View") || access?.can("Role.Permission.Assign")));
  const {
    data: permissions = [],
    isLoading: loadingPermissions,
    error: permissionsError,
  } = useOrganizationPermissions(undefined, Boolean(access?.can("Role.View") || access?.can("Role.Permission.Assign")));
  const save = useSaveOrganizationRole(slug);
  const [draft, setDraft] = useState<{ roleId: string; selected: string[]; baseline: string[] }>();
  const selected = draft?.roleId === roleId ? draft.selected : (role?.permissionIds ?? []);
  // Sort private copies for order-independent comparison on browsers without Array.toSorted.
  // eslint-disable-next-line unicorn/no-array-sort
  const dirty = Boolean(draft && JSON.stringify([...selected].sort()) !== JSON.stringify([...draft.baseline].sort()));
  const setFormDirty = useUIStore((state) => state.setFormDirty);
  useEffect(() => {
    setFormDirty("role-permissions", dirty);
    return () => setFormDirty("role-permissions", false);
  }, [dirty, setFormDirty]);
  if (accessLoading || isLoading) return <Skeleton rows={6} />;
  if (!access || (!access.can("Role.View") && !access.can("Role.Permission.Assign")))
    return <Navigate to="/my-work" replace />;
  if (error || !role) return <p role="alert">عملیات انجام نشد؛ اطلاعات واردشده را بررسی و دوباره تلاش کنید.</p>;
  const canEdit = access.can("Role.Permission.Assign");
  return (
    <div>
      <PageHeader
        eyebrow="مجوزهای نقش"
        title={role.name}
        description={role.description}
        actions={
          <Link className="button button-secondary" to="/roles">
            بازگشت به نقش‌ها
          </Link>
        }
      />
      {permissionsError ? (
        <p role="alert">عملیات انجام نشد؛ اطلاعات واردشده را بررسی و دوباره تلاش کنید.</p>
      ) : loadingPermissions ? (
        <Skeleton rows={6} />
      ) : (
        <section className="panel">
          <p role="status">
            {selected.length.toLocaleString("fa-IR")} مجوز انتخاب شده {dirty && "· تغییرات ذخیره نشده"}
          </p>
          <CompactMultiSelector
            expanded
            label="مجوزهای نقش"
            disabled={!canEdit || save.isPending}
            selected={selected}
            onChange={(ids) =>
              setDraft({
                roleId,
                selected: ids,
                baseline: draft?.roleId === roleId ? draft.baseline : role.permissionIds,
              })
            }
            options={[
              ...permissions.map(permissionPresentation).map((permission) => ({
                id: permission.id,
                title: permission.name,
                description: permission.description,
                category: permission.category,
                disabled: !permission.isActive,
              })),
              ...Array.from(new Set([...role.permissionIds, ...selected]))
                .filter((id) => !permissions.some((permission) => permission.id === id))
                .map((id) => ({
                  id,
                  title: "مجوز قدیمی یا غیرفعال",
                  category: "مجوزهای غیرفعال",
                  description: "تخصیص قبلی حفظ می‌شود؛ می‌توانید آن را بردارید ولی انتخاب دوباره ممکن نیست.",
                  disabled: true,
                })),
            ]}
          />
          {save.error && <p role="alert">{errorMessage(save.error, "ذخیره مجوزها انجام نشد.")}</p>}
          {canEdit && (
            <footer className="row-actions">
              <Button
                disabled={save.isPending || !dirty}
                onClick={() =>
                  save.mutate(
                    { id: roleId, permissionIds: selected },
                    {
                      onSuccess: (saved) =>
                        setDraft({ roleId, selected: saved.permissionIds, baseline: saved.permissionIds }),
                    }
                  )
                }
              >
                ذخیره مجوزها
              </Button>
              <Button variant="secondary" disabled={save.isPending || !dirty} onClick={() => setDraft(undefined)}>
                بازگردانی تغییرات
              </Button>
            </footer>
          )}
        </section>
      )}
    </div>
  );
}
