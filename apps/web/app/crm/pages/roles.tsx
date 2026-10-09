import { useState } from "react";
import { Plus } from "lucide-react";
import { Navigate } from "react-router";
import { PermissionCatalog } from "@plane/ui";
import {
  useOrganizationPermissions,
  useOrganizationRoles,
  useSaveOrganizationRole,
  useDeactivateOrganizationRole,
  useWorkspaceAccess,
} from "../api";
import { Button, PageHeader, SearchBox, Skeleton } from "../components";
import { AccessModal, MultiSelector } from "../access/components";
import { permissionPresentation } from "../access/permission-labels";
import { useUIStore } from "../store";
import type { OrganizationRole } from "../types";

export default function RolesPage() {
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const { data: roles = [], isLoading, error } = useOrganizationRoles(undefined, access?.can("Role.View") ?? false);
  const {
    data: permissions = [],
    isLoading: permissionsLoading,
    error: permissionsError,
  } = useOrganizationPermissions(undefined, access?.can("Permission.View") ?? false);
  const save = useSaveOrganizationRole(slug);
  const deactivate = useDeactivateOrganizationRole(slug);
  const [editing, setEditing] = useState<OrganizationRole>();
  const [roleQuery, setRoleQuery] = useState("");
  const presentedPermissions = permissions.map(permissionPresentation);
  const canEdit = access?.can("Role.Edit") || access?.can("Role.Permission.Assign");
  if (accessLoading) return <Skeleton rows={5} />;
  if (!access?.can("Role.View")) return <Navigate to="/my-work" replace />;
  return (
    <div>
      <PageHeader
        eyebrow="مدیریت سازمان"
        title="نقش‌ها و مجوزها"
        description="هر نقش مجموعه‌ای از مجوزهاست. کاربران می‌توانند چند نقش فعال داشته باشند."
        actions={
          access.can("Role.Create") && (
            <Button
              icon={Plus}
              onClick={() => setEditing({ id: "", name: "", description: "", permissionIds: [], isActive: true })}
            >
              نقش جدید
            </Button>
          )
        }
      />
      <SearchBox value={roleQuery} onChange={setRoleQuery} placeholder="جستجوی نام یا توضیح نقش…" />
      {error && <p role="alert">دریافت نقش‌ها انجام نشد.</p>}
      {isLoading ? (
        <Skeleton rows={5} />
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>نام نقش</th>
                <th>توضیح</th>
                <th>وضعیت</th>
                <th>مجوزها</th>
                <th>کاربران دارای نقش</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {roles
                .filter((role) => `${role.name} ${role.description}`.toLowerCase().includes(roleQuery.toLowerCase()))
                .map((role) => (
                  <tr key={role.id}>
                    <td>
                      {role.name} {role.systemKey && <small>پیش‌فرض</small>}
                    </td>
                    <td>{role.description}</td>
                    <td>{role.isActive ? "فعال" : "غیرفعال"}</td>
                    <td>{role.permissionIds.length.toLocaleString("fa-IR")}</td>
                    <td>{(role.userCount ?? 0).toLocaleString("fa-IR")}</td>
                    <td className="row-actions">
                      {!canEdit && (
                        <Button variant="secondary" onClick={() => setEditing(role)}>
                          مشاهده مجوزها
                        </Button>
                      )}
                      {(access.can("Role.Edit") || access.can("Role.Permission.Assign")) && (
                        <Button variant="secondary" onClick={() => setEditing(role)}>
                          {access.can("Role.Edit") ? "ویرایش" : "ویرایش مجوزها"}
                        </Button>
                      )}
                      {access.can("Role.Disable") && (
                        <Button
                          variant="secondary"
                          disabled={deactivate.isPending || save.isPending}
                          onClick={() =>
                            role.isActive ? deactivate.mutate(role.id) : save.mutate({ id: role.id, isActive: true })
                          }
                        >
                          {role.isActive ? "غیرفعال کردن" : "فعال کردن"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {access.can("Permission.View") && (
        <PermissionCatalog
          items={presentedPermissions}
          isLoading={permissionsLoading}
          hasError={Boolean(permissionsError)}
        />
      )}
      {editing && (
        <AccessModal
          title={editing.id ? (canEdit ? "ویرایش نقش" : "مشاهده نقش") : "نقش جدید"}
          busy={save.isPending}
          onClose={() => setEditing(undefined)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const original = roles.find((role) => role.id === editing.id);
              const originalPermissions = [...(original?.permissionIds ?? [])];
              const editedPermissions = [...editing.permissionIds];
              originalPermissions.sort();
              editedPermissions.sort();
              const permissionsChanged =
                !original || JSON.stringify(originalPermissions) !== JSON.stringify(editedPermissions);
              save.mutate(
                {
                  name: !editing.id || access.can("Role.Edit") ? editing.name : undefined,
                  description: !editing.id || access.can("Role.Edit") ? editing.description : undefined,
                  id: editing.id || undefined,
                  permissionIds:
                    access.can("Role.Permission.Assign") && permissionsChanged
                      ? editing.permissionIds.filter((id) =>
                          permissions.some((permission) => permission.id === id && permission.isActive)
                        )
                      : undefined,
                },
                { onSuccess: () => setEditing(undefined) }
              );
            }}
          >
            <label>
              <span>نام نقش</span>
              <input
                disabled={Boolean(editing.id) && !access.can("Role.Edit")}
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                required
              />
            </label>
            <label>
              <span>توضیح</span>
              <textarea
                disabled={Boolean(editing.id) && !access.can("Role.Edit")}
                value={editing.description}
                onChange={(event) => setEditing({ ...editing, description: event.target.value })}
              />
            </label>
            <MultiSelector
              label="مجوزهای نقش"
              disabled={!access.can("Role.Permission.Assign")}
              selected={editing.permissionIds}
              onChange={(permissionIds) => setEditing({ ...editing, permissionIds })}
              options={presentedPermissions.map((permission) => ({
                id: permission.id,
                title: permission.name,
                description: permission.description,
                category: permission.category,
                disabled: !permission.isActive,
              }))}
            />
            <footer>
              <Button variant="secondary" disabled={save.isPending} onClick={() => setEditing(undefined)}>
                انصراف
              </Button>
              {(!editing.id || canEdit) && (
                <Button type="submit" disabled={save.isPending || !editing.name.trim()}>
                  ذخیره نقش
                </Button>
              )}
            </footer>
          </form>
        </AccessModal>
      )}
    </div>
  );
}
