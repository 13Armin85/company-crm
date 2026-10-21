import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import {
  useOrganizationRoles,
  useSaveOrganizationRole,
  useDeleteOrganizationObject,
  useWorkspaceAccess,
  errorMessage,
} from "../api";
import { Button, PageHeader, SearchBox, Skeleton } from "../components";
import { AccessModal } from "../access/components";
import { useUIStore } from "../store";
import type { OrganizationRole } from "../types";
import { matchesRecordSearch } from "../identifiers";
import { SurfaceForm, SurfaceTable } from "../engine/surface";

export default function RolesPage() {
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const { data: roles = [], isLoading, error } = useOrganizationRoles(undefined, access?.can("Role.View") ?? false);
  const save = useSaveOrganizationRole(slug);
  const remove = useDeleteOrganizationObject(slug, "roles");
  const [editing, setEditing] = useState<OrganizationRole>();
  const [deleting, setDeleting] = useState<OrganizationRole>();
  const [query, setQuery] = useState("");
  const [params] = useSearchParams();
  const searchParam = params.get("search") ?? "";
  useEffect(() => setQuery(searchParam), [searchParam]);
  if (accessLoading) return <Skeleton rows={5} />;
  if (!access?.can("Role.View")) return <Navigate to="/my-work" replace />;
  return (
    <div>
      <PageHeader
        eyebrow="مدیریت سازمان"
        title="نقش‌های سازمانی"
        description="اطلاعات نقش و مجوزهای آن در فرم‌های مستقل مدیریت می‌شوند."
        actions={
          access.can("Role.Create") && (
            <Button
              onClick={() => {
                save.reset();
                setEditing({ id: "", name: "", description: "", permissionIds: [], isActive: true });
              }}
            >
              نقش جدید
            </Button>
          )
        }
      />
      <SearchBox value={query} onChange={setQuery} placeholder="جستجوی نام یا توضیح نقش…" />
      {error && <p role="alert">عملیات انجام نشد؛ اطلاعات واردشده را بررسی و دوباره تلاش کنید.</p>}
      {save.error && !editing && <p role="alert">{errorMessage(save.error, "تغییر وضعیت انجام نشد.")}</p>}
      {isLoading ? (
        <Skeleton rows={5} />
      ) : (
        <div className="table-card">
          <SurfaceTable code="roles">
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
                .filter((role) => matchesRecordSearch(query, [role.id, role.name, role.description]))
                .map((role) => (
                  <tr key={role.id}>
                    <td>
                      <div className="role-name-cell">
                        <span>{role.name}</span>
                        {role.systemKey && <small>سیستمی؛ قابل حذف نیست</small>}
                      </div>
                    </td>
                    <td>{role.description}</td>
                    <td>{role.isActive ? "فعال" : "غیرفعال"}</td>
                    <td>{role.permissionIds.length.toLocaleString("fa-IR")}</td>
                    <td>{(role.userCount ?? 0).toLocaleString("fa-IR")}</td>
                    <td className="row-actions">
                      {access.can("Role.Edit") && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            save.reset();
                            setEditing(role);
                          }}
                        >
                          ویرایش اطلاعات
                        </Button>
                      )}
                      <Link className="button button-secondary" to={`/roles/${role.id}/permissions`}>
                        {access.can("Role.Permission.Assign") ? "مدیریت مجوزها" : "مشاهده مجوزها"}
                      </Link>
                      {access.can("Role.Disable") && (
                        <Button
                          variant="secondary"
                          disabled={save.isPending}
                          onClick={() => save.mutate({ id: role.id, isActive: !role.isActive })}
                        >
                          {role.isActive ? "غیرفعال کردن" : "فعال کردن"}
                        </Button>
                      )}
                      {!role.systemKey && access.can("Role.Delete") && (
                        <Button
                          variant="danger"
                          onClick={() => {
                            remove.reset();
                            setDeleting(role);
                          }}
                        >
                          حذف نقش
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </SurfaceTable>
        </div>
      )}
      {editing && (
        <AccessModal
          title={editing.id ? "ویرایش اطلاعات نقش" : "نقش جدید"}
          busy={save.isPending}
          onClose={() => setEditing(undefined)}
        >
          <SurfaceForm
            code="roles"
            recordId={editing.id}
            onSubmit={(event, custom_values) => {
              event.preventDefault();
              if (save.isPending) return;
              save.mutate(
                { id: editing.id || undefined, name: editing.name, description: editing.description, custom_values },
                { onSuccess: () => setEditing(undefined) }
              );
            }}
          >
            <label>
              <span>نام نقش</span>
              <input
                required
                disabled={save.isPending}
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </label>
            <label>
              <span>توضیح</span>
              <textarea
                disabled={save.isPending}
                value={editing.description}
                onChange={(event) => setEditing({ ...editing, description: event.target.value })}
              />
            </label>
            {save.error && <p role="alert">{errorMessage(save.error, "ذخیره نقش انجام نشد.")}</p>}
            <footer>
              <Button variant="secondary" disabled={save.isPending} onClick={() => setEditing(undefined)}>
                انصراف
              </Button>
              <Button type="submit" disabled={save.isPending || !editing.name.trim()}>
                ذخیره نقش
              </Button>
            </footer>
          </SurfaceForm>
        </AccessModal>
      )}
      {deleting && (
        <AccessModal title="حذف نقش" busy={remove.isPending} onClose={() => setDeleting(undefined)}>
          <p>
            نقش «{deleting.name}» حذف می‌شود و مجوزهای آن از {(deleting.userCount ?? 0).toLocaleString("fa-IR")} کاربر
            گرفته می‌شود. مجوزهای نقش‌های دیگر و دسترسی‌های مستقیم حفظ می‌شوند.
          </p>
          {remove.error && <p role="alert">{errorMessage(remove.error, "حذف نقش انجام نشد.")}</p>}
          <footer>
            <Button variant="secondary" disabled={remove.isPending} onClick={() => setDeleting(undefined)}>
              انصراف
            </Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) })}
            >
              حذف نقش
            </Button>
          </footer>
        </AccessModal>
      )}
    </div>
  );
}
