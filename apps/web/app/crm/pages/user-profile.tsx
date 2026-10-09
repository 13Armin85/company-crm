import { useEffect, useMemo, useState } from "react";
import { Save, UserRound } from "lucide-react";
import { Navigate, useParams } from "react-router";
import {
  useOrganizationRoles,
  useOrganizationUnits,
  useOrganizationUserProfile,
  useUpdateOrganizationUserProfile,
  useWorkspaceAccess,
} from "../api";
import { MultiSelector } from "../access/components";
import { UserAccessPanel } from "../access/user-access";
import { Button, PageHeader, Skeleton } from "../components";
import { useUIStore } from "../store";
import type { OrganizationUserProfile } from "../types";

export default function UserProfilePage() {
  const { userId = "" } = useParams();
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const setFormDirty = useUIStore((state) => state.setFormDirty);
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const { data: profile, isLoading, error } = useOrganizationUserProfile(userId);
  const { data: roles = [] } = useOrganizationRoles(undefined, access?.can("User.Role.Assign") ?? false);
  const { data: units = [] } = useOrganizationUnits(
    undefined,
    (access?.can("OrganizationUnit.View") || access?.can("OrganizationUnit.Member.Manage")) ?? false
  );
  const update = useUpdateOrganizationUserProfile(slug, userId);
  const [form, setForm] = useState<OrganizationUserProfile>();
  useEffect(() => {
    if (profile) setForm(profile);
  }, [profile]);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(profile), [form, profile]);
  useEffect(() => {
    setFormDirty("organization-user-profile", isDirty);
    return () => setFormDirty("organization-user-profile", false);
  }, [isDirty, setFormDirty]);
  if (accessLoading) return <Skeleton rows={6} />;
  if (!access?.can("User.View")) return <Navigate to="/my-work" replace />;
  if (error) return <p role="alert">دریافت پروفایل انجام نشد.</p>;
  if (isLoading || !form) return <Skeleton rows={7} />;
  const canEdit = access.can("User.Edit");
  const canSave = canEdit || access.can("User.Role.Assign") || access.can("OrganizationUnit.Member.Manage");
  return (
    <div>
      <PageHeader
        eyebrow="مدیریت کاربران"
        title={form.displayName || "پروفایل کاربر"}
        description="اطلاعات هویتی و دسترسی‌های کاربر در این شرکت"
        actions={
          canSave && (
            <Button
              icon={Save}
              disabled={update.isPending || !isDirty}
              onClick={() =>
                update.mutate({
                  ...(canEdit
                    ? {
                        first_name: form.firstName,
                        last_name: form.lastName,
                        display_name: form.displayName,
                        username: form.username,
                        email: form.email,
                        is_active: form.isActive,
                      }
                    : {}),
                  role_ids:
                    access.can("User.Role.Assign") &&
                    form.isActive &&
                    profile?.isActive &&
                    JSON.stringify(form.roleIds) !== JSON.stringify(profile.roleIds)
                      ? form.roleIds
                      : undefined,
                  unit_ids:
                    access.can("OrganizationUnit.Member.Manage") &&
                    form.isActive &&
                    profile?.isActive &&
                    JSON.stringify(form.unitIds) !== JSON.stringify(profile.unitIds)
                      ? form.unitIds
                      : undefined,
                })
              }
            >
              ذخیره تغییرات
            </Button>
          )
        }
      />
      <section className="panel user-profile-admin">
        <header>
          <UserRound size={24} />
          <h2>اطلاعات حساب</h2>
        </header>
        <fieldset disabled={!canEdit || update.isPending}>
          <div className="form-grid">
            <label>
              <span>نام</span>
              <input value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} />
            </label>
            <label>
              <span>نام خانوادگی</span>
              <input value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
            </label>
            <label>
              <span>نام نمایشی</span>
              <input
                value={form.displayName}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              />
            </label>
            <label>
              <span>نام کاربری</span>
              <input
                dir="ltr"
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
              />
            </label>
            <label>
              <span>ایمیل</span>
              <input
                dir="ltr"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>
          </div>
          <label className="active-toggle">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            />
            <span>عضویت فعال در این شرکت</span>
          </label>
        </fieldset>
      </section>
      <div className="profile-assignment-grid">
        <section className="panel assignment-card">
          <h2>نقش‌ها</h2>
          {!form.isActive && <p>برای تغییر نقش، ابتدا عضویت کاربر را فعال و ذخیره کنید.</p>}
          <MultiSelector
            label="نقش‌های سازمانی"
            disabled={update.isPending || !access.can("User.Role.Assign") || !form.isActive || !profile?.isActive}
            selected={form.roleIds}
            onChange={(roleIds) => setForm({ ...form, roleIds })}
            options={roles.map((role) => ({
              id: role.id,
              title: role.name,
              description: role.description,
              disabled: !role.isActive,
            }))}
          />
        </section>
        <section className="panel assignment-card">
          <h2>واحدهای سازمانی</h2>
          <MultiSelector
            label="واحدها"
            disabled={update.isPending || !access.can("OrganizationUnit.Member.Manage") || !form.isActive}
            selected={form.unitIds}
            onChange={(unitIds) => setForm({ ...form, unitIds })}
            options={units.map((unit) => ({
              id: unit.id,
              title: unit.title,
              description: unit.managerName,
              disabled: !unit.isActive,
            }))}
          />
        </section>
      </div>
      <UserAccessPanel userId={userId} />
    </div>
  );
}
