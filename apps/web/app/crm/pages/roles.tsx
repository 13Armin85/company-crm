import { useEffect, useState } from "react";
import { Edit3, KeyRound, Plus, ShieldCheck, XCircle } from "lucide-react";
import { Navigate } from "react-router";
import {
  useDeactivateOrganizationPermission,
  useDeactivateOrganizationRole,
  useOrganizationPermissions,
  useOrganizationRoles,
  useSaveOrganizationPermission,
  useSaveOrganizationRole,
  useWorkspaceAccess,
} from "../api";
import { Button, EmptyState, PageHeader, Skeleton } from "../components";
import { useUIStore } from "../store";
import type { OrganizationPermission, OrganizationRole } from "../types";
import { toFa } from "../utils";

type RoleForm = Pick<OrganizationRole, "name" | "level" | "permissionIds" | "isActive"> & { id?: string };
type PermissionForm = Pick<OrganizationPermission, "code" | "name" | "description" | "isActive"> & { id?: string };

export default function RolesPage() {
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const setFormDirty = useUIStore((state) => state.setFormDirty);
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const isAdmin = access?.isAdmin === true;
  const { data: roles = [], isLoading } = useOrganizationRoles(undefined, isAdmin);
  const { data: permissions = [], isLoading: permissionsLoading } = useOrganizationPermissions(undefined, isAdmin);
  const saveRole = useSaveOrganizationRole(slug);
  const deactivateRole = useDeactivateOrganizationRole(slug);
  const savePermission = useSaveOrganizationPermission(slug);
  const deactivatePermission = useDeactivateOrganizationPermission(slug);
  const [editingRole, setEditingRole] = useState<RoleForm>();
  const [editingPermission, setEditingPermission] = useState<PermissionForm>();

  useEffect(() => {
    setFormDirty("organization-access", Boolean(editingRole || editingPermission));
    return () => setFormDirty("organization-access", false);
  }, [editingPermission, editingRole, setFormDirty]);

  if (accessLoading) return <Skeleton rows={5} />;
  if (!access?.isAdmin) return <Navigate to="/my-work" replace />;

  return (
    <div>
      <PageHeader
        eyebrow="مدیریت سازمان"
        title="نقش‌ها و دسترسی‌ها"
        description="Role جایگاه سازمانی، Level معیار سلسله‌مراتب و Permission دسترسی عملیاتی مستقل است."
        actions={
          <div className="page-actions">
            <Button
              icon={KeyRound}
              variant="secondary"
              onClick={() => setEditingPermission({ code: "", name: "", description: "", isActive: true })}
            >
              دسترسی جدید
            </Button>
            <Button
              icon={Plus}
              onClick={() => setEditingRole({ name: "", level: 10, permissionIds: [], isActive: true })}
            >
              نقش جدید
            </Button>
          </div>
        }
      />

      <section className="management-section">
        <header className="section-heading">
          <div>
            <h2>Role Management</h2>
            <p>هر کاربر می‌تواند هم‌زمان چند نقش فعال داشته باشد.</p>
          </div>
        </header>
        <div className="table-card organization-table">
          {isLoading ? (
            <Skeleton rows={5} />
          ) : !roles.length ? (
            <EmptyState title="نقشی تعریف نشده" description="اولین نقش سازمانی را بسازید." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>نام</th>
                  <th>Level</th>
                  <th>Permissionها</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id}>
                    <td>
                      <span className="role-title">
                        <ShieldCheck size={17} />
                        {role.name}
                      </span>
                    </td>
                    <td>{toFa(role.level)}</td>
                    <td>{toFa(role.permissionIds.length)}</td>
                    <td>
                      <span className={`state-pill ${role.isActive ? "is-on" : "is-off"}`}>
                        {role.isActive ? "فعال" : "غیرفعال"}
                      </span>
                    </td>
                    <td className="row-actions">
                      <button onClick={() => setEditingRole(role)} title="ویرایش">
                        <Edit3 size={16} />
                      </button>
                      {role.isActive && (
                        <button onClick={() => deactivateRole.mutate(role.id)} title="غیرفعال‌کردن">
                          <XCircle size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="management-section">
        <header className="section-heading">
          <div>
            <h2>Permission Management</h2>
            <p>مجوزهای عملیاتی بدون وابستگی به عنوان شغلی تعریف می‌شوند.</p>
          </div>
        </header>
        <div className="table-card organization-table">
          {permissionsLoading ? (
            <Skeleton rows={4} />
          ) : !permissions.length ? (
            <EmptyState
              title="دسترسی عملیاتی تعریف نشده"
              description="Permissionهای مورد نیاز فرایندها را ایجاد کنید."
            />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>کد</th>
                  <th>نام</th>
                  <th>توضیح</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {permissions.map((permission) => (
                  <tr key={permission.id}>
                    <td dir="ltr">
                      <code>{permission.code}</code>
                    </td>
                    <td>{permission.name}</td>
                    <td>{permission.description || "—"}</td>
                    <td>
                      <span className={`state-pill ${permission.isActive ? "is-on" : "is-off"}`}>
                        {permission.isActive ? "فعال" : "غیرفعال"}
                      </span>
                    </td>
                    <td className="row-actions">
                      <button onClick={() => setEditingPermission(permission)} title="ویرایش">
                        <Edit3 size={16} />
                      </button>
                      {permission.isActive && (
                        <button onClick={() => deactivatePermission.mutate(permission.id)} title="غیرفعال‌کردن">
                          <XCircle size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {editingRole && (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && setEditingRole(undefined)}
        >
          <form
            className="create-modal organization-modal"
            onSubmit={(event) => {
              event.preventDefault();
              saveRole.mutate(editingRole, { onSuccess: () => setEditingRole(undefined) });
            }}
          >
            <header>
              <div>
                <span className="modal-kicker">Role Management</span>
                <h2>{editingRole.id ? "ویرایش نقش" : "نقش جدید"}</h2>
              </div>
            </header>
            <label>
              <span>نام نقش</span>
              <input
                value={editingRole.name}
                onChange={(event) => setEditingRole({ ...editingRole, name: event.target.value })}
                required
              />
            </label>
            <label>
              <span>Level</span>
              <input
                type="number"
                min={0}
                value={editingRole.level}
                onChange={(event) => setEditingRole({ ...editingRole, level: Number(event.target.value) })}
                required
              />
            </label>
            <label className="active-toggle">
              <input
                type="checkbox"
                checked={editingRole.isActive}
                onChange={(event) => setEditingRole({ ...editingRole, isActive: event.target.checked })}
              />
              <span>نقش فعال باشد</span>
            </label>
            <fieldset className="member-picker permission-picker">
              <legend>
                <KeyRound size={15} /> دسترسی‌های عملیاتی
              </legend>
              {permissions
                .filter((permission) => permission.isActive || editingRole.permissionIds.includes(permission.id))
                .map((permission) => (
                  <label key={permission.id} className={!permission.isActive ? "is-inactive" : ""}>
                    <input
                      type="checkbox"
                      disabled={!permission.isActive}
                      checked={editingRole.permissionIds.includes(permission.id)}
                      onChange={(event) =>
                        setEditingRole({
                          ...editingRole,
                          permissionIds: event.target.checked
                            ? [...editingRole.permissionIds, permission.id]
                            : editingRole.permissionIds.filter((id) => id !== permission.id),
                        })
                      }
                    />
                    <span>
                      {permission.name}
                      <small dir="ltr">{permission.code}</small>
                    </span>
                  </label>
                ))}
            </fieldset>
            <footer>
              <Button variant="secondary" onClick={() => setEditingRole(undefined)}>
                انصراف
              </Button>
              <Button type="submit" disabled={saveRole.isPending || !editingRole.name.trim()}>
                ذخیره نقش
              </Button>
            </footer>
          </form>
        </div>
      )}

      {editingPermission && (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && setEditingPermission(undefined)}
        >
          <form
            className="create-modal"
            onSubmit={(event) => {
              event.preventDefault();
              savePermission.mutate(editingPermission, { onSuccess: () => setEditingPermission(undefined) });
            }}
          >
            <header>
              <div>
                <span className="modal-kicker">Permission Management</span>
                <h2>{editingPermission.id ? "ویرایش دسترسی" : "دسترسی جدید"}</h2>
              </div>
            </header>
            <label>
              <span>کد یکتا</span>
              <input
                dir="ltr"
                pattern="[a-z0-9_-]+"
                value={editingPermission.code}
                onChange={(event) =>
                  setEditingPermission({
                    ...editingPermission,
                    code: event.target.value.toLowerCase().replace(/\s+/g, "-"),
                  })
                }
                required
              />
            </label>
            <label>
              <span>نام نمایشی</span>
              <input
                value={editingPermission.name}
                onChange={(event) => setEditingPermission({ ...editingPermission, name: event.target.value })}
                required
              />
            </label>
            <label>
              <span>توضیح</span>
              <textarea
                value={editingPermission.description}
                onChange={(event) => setEditingPermission({ ...editingPermission, description: event.target.value })}
              />
            </label>
            <label className="active-toggle">
              <input
                type="checkbox"
                checked={editingPermission.isActive}
                onChange={(event) => setEditingPermission({ ...editingPermission, isActive: event.target.checked })}
              />
              <span>دسترسی فعال باشد</span>
            </label>
            <footer>
              <Button variant="secondary" onClick={() => setEditingPermission(undefined)}>
                انصراف
              </Button>
              <Button
                type="submit"
                disabled={savePermission.isPending || !editingPermission.code.trim() || !editingPermission.name.trim()}
              >
                ذخیره دسترسی
              </Button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}
