import { ErrorState } from "../error-state";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, Mail, Save, ShieldCheck, UserRound } from "lucide-react";
import { Link, Navigate, useParams } from "react-router";
import {
  useOrganizationRoles,
  useOrganizationUnits,
  useOrganizationUserProfile,
  useUpdateOrganizationUserProfile,
  useWorkspaceAccess,
  errorMessage,
} from "../api";
import { MultiSelector } from "../access/components";
import { UserAccessPanel } from "../access/user-access";
import { Button, Skeleton } from "../components";
import { useUIStore } from "../store";
import type { OrganizationUserProfile } from "../types";
import type { FormValues } from "@plane/ui";
import { SurfaceFields } from "../engine/surface";

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
  const [customValues, setCustomValues] = useState<FormValues>();
  useEffect(() => {
    if (profile) setForm((current) => (!current || current.id !== profile.id ? profile : current));
  }, [profile, form?.id]);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(profile), [form, profile]);
  useEffect(() => {
    setFormDirty("organization-user-profile", isDirty);
    return () => setFormDirty("organization-user-profile", false);
  }, [isDirty, setFormDirty]);
  if (accessLoading) return <Skeleton rows={6} />;
  if (!access?.can("User.View")) return <Navigate to="/my-work" replace />;
  if (error) return <ErrorState message={errorMessage(error, "دریافت پروفایل این کاربر انجام نشد")} />;
  if (isLoading || !form) return <Skeleton rows={7} />;
  const canEdit = access.can("User.Edit");
  const canSave = canEdit || access.can("User.Role.Assign") || access.can("OrganizationUnit.Member.Manage");
  const initials = (form.displayName || `${form.firstName} ${form.lastName}`).trim().slice(0, 2) || "؟";
  return (
    <div className="user-profile-page">
      <div className="user-profile-topbar">
        <Link to="/team" className="user-profile-back">
          <ArrowRight size={17} /> بازگشت به اعضای تیم
        </Link>
        {canSave && (
          <Button
            icon={Save}
            disabled={update.isPending || (!isDirty && !customValues)}
            onClick={() =>
              update.mutate(
                {
                  ...(canEdit && customValues ? { custom_values: customValues } : {}),
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
                },
                {
                  onSuccess: () => {
                    setForm(undefined);
                    setCustomValues(undefined);
                  },
                }
              )
            }
          >
            ذخیره تغییرات
          </Button>
        )}
      </div>
      <header className="user-profile-hero">
        <span className="user-profile-avatar" aria-hidden="true">
          {initials}
        </span>
        <div className="user-profile-hero-copy">
          <span className="user-profile-eyebrow">پروفایل عضو تیم</span>
          <h1>{form.displayName || "پروفایل کاربر"}</h1>
          <div className="user-profile-meta">
            <span dir="ltr">@{form.username}</span>
            <span>
              <Mail size={15} /> <bdi>{form.email}</bdi>
            </span>
          </div>
        </div>
        <span className={`user-profile-status ${form.isActive ? "is-active" : ""}`}>
          <i aria-hidden="true" />
          {form.isActive ? "عضو فعال" : "عضو غیرفعال"}
        </span>
      </header>
      <SurfaceFields code="users" recordId={userId} onChange={setCustomValues} disabled={!canEdit || update.isPending}>
        <section className="panel user-profile-admin">
          <header>
            <span className="user-profile-section-icon">
              <UserRound size={20} />
            </span>
            <div>
              <h2>اطلاعات حساب</h2>
              <p>مشخصات هویتی و راه‌های شناسایی این عضو</p>
            </div>
          </header>
          <fieldset disabled={!canEdit || update.isPending}>
            <div className="form-grid">
              <label>
                <span>نام</span>
                <input
                  value={form.firstName}
                  onChange={(event) => setForm({ ...form, firstName: event.target.value })}
                />
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
            <header>
              <span className="user-profile-section-icon">
                <ShieldCheck size={19} />
              </span>
              <div>
                <h2>نقش‌ها</h2>
                <p>سطح دسترسی از نقش‌های سازمانی</p>
              </div>
            </header>
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
            <header>
              <span className="user-profile-section-icon">
                <Building2 size={19} />
              </span>
              <div>
                <h2>واحدهای سازمانی</h2>
                <p>تیم‌ها و واحدهای مرتبط با این عضو</p>
              </div>
            </header>
            <MultiSelector
              label="واحدها"
              disabled={
                update.isPending ||
                !access.can("OrganizationUnit.Member.Manage") ||
                !form.isActive ||
                !profile?.isActive
              }
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
      </SurfaceFields>
      <UserAccessPanel userId={userId} />
    </div>
  );
}
