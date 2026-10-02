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
import { Button, PageHeader, Skeleton } from "../components";
import { useUIStore } from "../store";
import type { OrganizationUserProfile } from "../types";
import { toFa } from "../utils";

export default function UserProfilePage() {
  const { userId = "" } = useParams();
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const setFormDirty = useUIStore((state) => state.setFormDirty);
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const { data: profile, isLoading } = useOrganizationUserProfile(userId);
  const isAdmin = access?.isAdmin === true;
  const { data: roles = [] } = useOrganizationRoles(undefined, isAdmin);
  const { data: units = [] } = useOrganizationUnits(undefined, isAdmin);
  const updateProfile = useUpdateOrganizationUserProfile(slug, userId);
  const [form, setForm] = useState<OrganizationUserProfile & { password: string }>();
  useEffect(() => {
    if (profile) setForm({ ...profile, password: "" });
  }, [profile]);
  const isDirty = useMemo(() => {
    if (!form || !profile) return false;
    const sameIds = (left: string[], right: string[]) =>
      left.length === right.length && left.every((id) => right.includes(id));
    return (
      form.firstName !== profile.firstName ||
      form.lastName !== profile.lastName ||
      form.displayName !== profile.displayName ||
      form.username !== profile.username ||
      form.email !== profile.email ||
      form.isActive !== profile.isActive ||
      Boolean(form.password) ||
      !sameIds(form.roleIds, profile.roleIds) ||
      !sameIds(form.unitIds, profile.unitIds)
    );
  }, [form, profile]);
  useEffect(() => {
    setFormDirty("organization-user-profile", isDirty);
    return () => setFormDirty("organization-user-profile", false);
  }, [isDirty, setFormDirty]);
  const maximumSelectedLevel = useMemo(
    () =>
      Math.max(
        0,
        ...roles.filter((role) => form?.roleIds.includes(role.id) && role.isActive).map((role) => role.level)
      ),
    [form?.roleIds, roles]
  );
  if (accessLoading) return <Skeleton rows={6} />;
  if (!access?.isAdmin) return <Navigate to="/my-work" replace />;
  if (isLoading || !form) return <Skeleton rows={7} />;
  const toggle = (key: "roleIds" | "unitIds", id: string, checked: boolean) =>
    setForm({ ...form, [key]: checked ? [...form[key], id] : form[key].filter((value) => value !== id) });
  return (
    <div>
      <PageHeader
        eyebrow="مدیریت کاربران"
        title={form.displayName || "پروفایل کاربر"}
        description={`بالاترین Level فعال: ${toFa(maximumSelectedLevel)}`}
        actions={
          <Button
            icon={Save}
            type="submit"
            disabled={updateProfile.isPending}
            onClick={() =>
              updateProfile.mutate({
                first_name: form.firstName,
                last_name: form.lastName,
                display_name: form.displayName,
                username: form.username,
                email: form.email,
                password: form.password || undefined,
                is_active: form.isActive,
                role_ids: form.roleIds,
                unit_ids: form.unitIds,
              })
            }
          >
            ذخیره تغییرات
          </Button>
        }
      />
      <section className="panel user-profile-admin">
        <header>
          <UserRound size={24} />
          <div>
            <h2>اطلاعات حساب</h2>
            <p>نام کاربری و ایمیل در کل سیستم یکتا هستند.</p>
          </div>
        </header>
        <div className="form-grid">
          <label>
            <span>نام</span>
            <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </label>
          <label>
            <span>نام خانوادگی</span>
            <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </label>
          <label>
            <span>نام نمایشی</span>
            <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </label>
          <label>
            <span>Username</span>
            <input dir="ltr" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </label>
          <label>
            <span>Email</span>
            <input
              dir="ltr"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            <span>رمز عبور جدید (اختیاری)</span>
            <input
              dir="ltr"
              type="password"
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
        </div>
        <label className="active-toggle">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          <span>حساب فعال باشد</span>
        </label>
      </section>
      <div className="profile-assignment-grid">
        <section className="panel assignment-card">
          <h2>Roleها</h2>
          <p>یک کاربر می‌تواند هم‌زمان چند نقش فعال داشته باشد.</p>
          {roles.map((role) => (
            <label key={role.id} className={!role.isActive ? "is-inactive" : ""}>
              <input
                type="checkbox"
                disabled={!role.isActive}
                checked={form.roleIds.includes(role.id)}
                onChange={(e) => toggle("roleIds", role.id, e.target.checked)}
              />
              <span>
                {role.name}
                <small>Level {toFa(role.level)}</small>
              </span>
            </label>
          ))}
        </section>
        <section className="panel assignment-card">
          <h2>Teamها</h2>
          <p>عضویت تیم مستقل از Role است.</p>
          {units.map((unit) => (
            <label key={unit.id} className={!unit.isActive ? "is-inactive" : ""}>
              <input
                type="checkbox"
                disabled={!unit.isActive}
                checked={form.unitIds.includes(unit.id)}
                onChange={(e) => toggle("unitIds", unit.id, e.target.checked)}
              />
              <span>
                {unit.title}
                <small>{unit.managerName ? `مدیر: ${unit.managerName}` : "بدون مدیر"}</small>
              </span>
            </label>
          ))}
        </section>
      </div>
    </div>
  );
}
