import { useEffect, useState } from "react";
import {
  Bell,
  Building2,
  Check,
  ChevronLeft,
  ImagePlus,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Save,
  Shield,
  Sun,
  UserCircle,
  Users,
} from "lucide-react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { Avatar, Button, PageHeader } from "../components";
import {
  useAppearance,
  useChangePassword,
  useCurrentUser,
  useNotificationPreferences,
  useSignOut,
  useUpdateAppearance,
  useUpdateNotificationPreferences,
  useUpdateUserProfile,
  useUpdateWorkspace,
  useUploadAvatar,
  useWorkspaceAccess,
  useWorkspaces,
} from "../api";
import { useUIStore } from "../store";
import type { ThemeMode } from "../store";

const settingsNav = [
  { id: "profile", label: "پروفایل من", icon: UserCircle },
  { id: "general", label: "عمومی", icon: Building2 },
  { id: "members", label: "اعضا و دسترسی", icon: Users },
  { id: "notifications", label: "اعلان‌ها", icon: Bell },
  { id: "security", label: "امنیت", icon: Shield },
];
const themes: { id: ThemeMode; label: string; description: string; icon: typeof Sun }[] = [
  { id: "light", label: "روشن", description: "فضای روشن و شفاف", icon: Sun },
  { id: "dark", label: "تیره", description: "مناسب محیط کم‌نور", icon: Moon },
  { id: "system", label: "سیستم", description: "هماهنگ با دستگاه", icon: Monitor },
];
const accents = ["#4F46E5", "#2563EB", "#0F766E", "#9333EA", "#DB2777"];
export default function SettingsPage() {
  const [params] = useSearchParams();
  const [section, setSection] = useState(params.get("section") || "general");
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const density = useUIStore((state) => state.density);
  const setDensity = useUIStore((state) => state.setDensity);
  const workspaceSlug = useUIStore((state) => state.workspaceSlug) ?? "";
  const { data: workspaces = [] } = useWorkspaces();
  const workspace = workspaces.find((item) => item.slug === workspaceSlug);
  const [workspaceName, setWorkspaceName] = useState("");
  const updateWorkspace = useUpdateWorkspace(workspaceSlug);
  const { data: access } = useWorkspaceAccess();
  const isAdmin = access?.isAdmin === true;
  const { data: savedAppearance } = useAppearance();
  const updateAppearance = useUpdateAppearance();
  const { data: notificationPreferences } = useNotificationPreferences();
  const updateNotifications = useUpdateNotificationPreferences();
  const [accent, setAccent] = useState("#4F46E5");
  useEffect(() => {
    const requestedSection = params.get("section");
    if (requestedSection && settingsNav.some((item) => item.id === requestedSection)) setSection(requestedSection);
  }, [params]);
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
  }, [accent]);
  useEffect(() => {
    if (savedAppearance) setAccent(savedAppearance.accent);
  }, [savedAppearance]);
  useEffect(() => setWorkspaceName(workspace?.name ?? ""), [workspace?.name]);
  useEffect(() => {
    if (access && !isAdmin && section === "members") setSection("profile");
  }, [access, isAdmin, section]);
  return (
    <div>
      <PageHeader
        eyebrow="فضای کاری"
        title="تنظیمات"
        description="فضای کاری و تجربه شخصی خود را مدیریت کنید"
        actions={
          isAdmin ? (
            <Button
              icon={Save}
              onClick={() => workspaceName.trim() && updateWorkspace.mutate({ name: workspaceName })}
              disabled={!workspaceSlug || updateWorkspace.isPending}
            >
              ذخیره تغییرات
            </Button>
          ) : undefined
        }
      />
      <div className="settings-layout">
        <aside className="settings-nav">
          {settingsNav
            .filter((item) => item.id !== "members" || isAdmin)
            .map(({ id, label, icon: Icon }) => (
              <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>
                <Icon size={18} />
                <span>{label}</span>
                <ChevronLeft size={15} />
              </button>
            ))}
        </aside>
        <main className="settings-main">
          {section === "profile" ? (
            <ProfileSettings />
          ) : section === "members" && isAdmin ? (
            <section className="settings-section settings-connected">
              <Users size={28} />
              <div>
                <h2>اعضا و دسترسی‌ها</h2>
                <p>دعوت اعضا، تغییر نقش و حذف دسترسی در صفحه مدیریت تیم انجام می‌شود.</p>
                <Link className="button button-primary" to="/team">
                  مدیریت اعضا
                </Link>
              </div>
            </section>
          ) : section === "notifications" ? (
            <section className="settings-section">
              <header>
                <div>
                  <h2>اعلان‌ها</h2>
                  <p>این انتخاب‌ها در پایگاه داده حساب شما ذخیره می‌شوند.</p>
                </div>
              </header>
              <div className="notification-preferences">
                {notificationPreferences &&
                  (
                    [
                      ["property_change", "تغییر مشخصات کار"],
                      ["state_change", "تغییر وضعیت"],
                      ["comment", "دیدگاه‌ها"],
                      ["mention", "اشاره به شما"],
                      ["issue_completed", "تکمیل کار"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={notificationPreferences[key]}
                        onChange={(event) => updateNotifications.mutate({ [key]: event.target.checked })}
                      />
                    </label>
                  ))}
              </div>
            </section>
          ) : section === "security" ? (
            <SecuritySettings />
          ) : (
            <>
              <section className="settings-section">
                <header>
                  <div>
                    <h2>مشخصات فضای کاری</h2>
                    <p>اطلاعاتی که برای همه اعضای تیم نمایش داده می‌شود.</p>
                  </div>
                </header>
                <div className="workspace-profile">
                  <span className="workspace-logo">{workspace?.name.slice(0, 1) ?? "هـ"}</span>
                </div>
                <div className="form-grid">
                  <label>
                    <span>نام فضای کاری</span>
                    <input
                      value={workspaceName}
                      readOnly={!isAdmin}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>آدرس فضای کاری</span>
                    <div className="slug-input">
                      <span>app.hamkar.ir/</span>
                      <input dir="ltr" value={workspace?.slug ?? ""} readOnly />
                    </div>
                  </label>
                </div>
              </section>
              <section className="settings-section appearance-section">
                <header>
                  <div>
                    <h2>
                      <Palette size={20} /> ظاهر و ترجیحات
                    </h2>
                    <p>تم و چیدمان را متناسب با سبک کاری خودتان تنظیم کنید.</p>
                  </div>
                </header>
                <h3>تم رابط کاربری</h3>
                <div className="theme-options">
                  {themes.map(({ id, label, description, icon: Icon }) => (
                    <button
                      key={id}
                      className={theme === id ? "active" : ""}
                      onClick={() => {
                        setTheme(id);
                        updateAppearance.mutate({ theme: id });
                      }}
                    >
                      <span className={`theme-preview preview-${id}`}>
                        <Icon size={20} />
                      </span>
                      <div>
                        <b>{label}</b>
                        <small>{description}</small>
                      </div>
                      {theme === id && (
                        <i>
                          <Check size={14} />
                        </i>
                      )}
                    </button>
                  ))}
                </div>
                <h3>رنگ اصلی</h3>
                <div className="accent-options">
                  {accents.map((color) => (
                    <button
                      key={color}
                      style={{ background: color }}
                      className={accent === color ? "active" : ""}
                      onClick={() => {
                        setAccent(color);
                        updateAppearance.mutate({ accent: color });
                      }}
                    >
                      {accent === color && <Check size={15} />}
                    </button>
                  ))}
                </div>
                <h3>چیدمان محتوا</h3>
                <div className="layout-options">
                  <button
                    className={density === "comfortable" ? "active" : ""}
                    onClick={() => {
                      setDensity("comfortable");
                      updateAppearance.mutate({ density: "comfortable" });
                    }}
                  >
                    <span className="layout-preview comfortable">
                      <i />
                      <i />
                      <i />
                    </span>
                    <div>
                      <b>راحت و باز</b>
                      <small>فاصله بیشتر برای تمرکز بهتر</small>
                    </div>
                    {density === "comfortable" && <Check size={17} />}
                  </button>
                  <button
                    className={density === "compact" ? "active" : ""}
                    onClick={() => {
                      setDensity("compact");
                      updateAppearance.mutate({ density: "compact" });
                    }}
                  >
                    <span className="layout-preview compact">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    <div>
                      <b>فشرده و کاربردی</b>
                      <small>نمایش داده بیشتر در هر صفحه</small>
                    </div>
                    {density === "compact" && <Check size={17} />}
                  </button>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function ProfileSettings() {
  const { data: user } = useCurrentUser();
  const [displayName, setDisplayName] = useState("");
  const updateProfile = useUpdateUserProfile();
  const uploadAvatar = useUploadAvatar();
  const signOut = useSignOut();
  const dirtyForms = useUIStore((state) => state.dirtyForms);
  const setFormDirty = useUIStore((state) => state.setFormDirty);
  const clearDirtyForms = useUIStore((state) => state.clearDirtyForms);
  const [logoutOpen, setLogoutOpen] = useState(false);
  useEffect(() => setDisplayName(user?.displayName ?? ""), [user?.displayName]);
  useEffect(() => {
    setFormDirty("profile", Boolean(user && displayName !== user.displayName));
    return () => setFormDirty("profile", false);
  }, [displayName, setFormDirty, user]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (displayName.trim()) updateProfile.mutate({ display_name: displayName.trim() });
  };
  return (
    <form className="settings-section profile-settings" onSubmit={submit}>
      <header>
        <div>
          <h2>پروفایل من</h2>
          <p>نام و تصویر شما برای اعضای فضای کاری نمایش داده می‌شود.</p>
        </div>
      </header>
      <div className="profile-avatar-editor">
        <Avatar member={user} size="lg" />
        <label className="button button-secondary">
          <ImagePlus size={17} />
          {uploadAvatar.isPending ? "در حال بارگذاری..." : "انتخاب تصویر پروفایل"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={uploadAvatar.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) uploadAvatar.mutate(file);
              event.target.value = "";
            }}
          />
        </label>
        <small>JPG، PNG، WebP یا GIF تا حجم ۵ مگابایت</small>
      </div>
      <div className="form-grid">
        <label>
          <span>نام نمایشی</span>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
        </label>
        <label>
          <span>ایمیل حساب</span>
          <input value={user?.email ?? ""} dir="ltr" readOnly />
        </label>
      </div>
      <Button type="submit" icon={Save} disabled={updateProfile.isPending || !displayName.trim()}>
        ذخیره پروفایل
      </Button>
      <Button variant="danger" icon={LogOut} onClick={() => setLogoutOpen(true)} disabled={signOut.isPending}>
        خروج از حساب
      </Button>
      {logoutOpen && (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && setLogoutOpen(false)}
        >
          <section
            className="create-modal logout-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="logout-title"
          >
            <header>
              <div>
                <span className="modal-kicker">تأیید خروج</span>
                <h2 id="logout-title">آیا مطمئن هستید می‌خواهید خارج شوید؟</h2>
              </div>
            </header>
            <p>
              {dirtyForms.length
                ? "فرم ذخیره‌نشده دارید. با خروج، تغییرات ذخیره‌نشده از بین می‌رود."
                : "برای پایان‌دادن به نشست فعلی، خروج را تأیید کنید."}
            </p>
            <footer>
              <Button variant="secondary" onClick={() => setLogoutOpen(false)}>
                لغو
              </Button>
              <Button
                variant="danger"
                icon={LogOut}
                onClick={() => {
                  clearDirtyForms();
                  signOut.mutate();
                }}
                disabled={signOut.isPending}
              >
                خروج
              </Button>
            </footer>
          </section>
        </div>
      )}
    </form>
  );
}

function SecuritySettings() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const changePassword = useChangePassword();
  const setFormDirty = useUIStore((state) => state.setFormDirty);
  useEffect(() => {
    setFormDirty("security", Boolean(oldPassword || newPassword));
    return () => setFormDirty("security", false);
  }, [newPassword, oldPassword, setFormDirty]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    changePassword.mutate(
      { old_password: oldPassword, new_password: newPassword },
      {
        onSuccess: () => {
          setOldPassword("");
          setNewPassword("");
        },
      }
    );
  };
  return (
    <form className="settings-section security-form" onSubmit={submit}>
      <header>
        <div>
          <h2>امنیت حساب</h2>
          <p>رمز جدید مستقیماً در بک‌اند اعتبارسنجی و به‌صورت هش‌شده در پایگاه داده ذخیره می‌شود.</p>
        </div>
      </header>
      <label>
        <span>رمز عبور فعلی</span>
        <input type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} required />
      </label>
      <label>
        <span>رمز عبور جدید</span>
        <input
          type="password"
          minLength={8}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
        />
      </label>
      <Button type="submit" icon={Shield} disabled={changePassword.isPending}>
        تغییر رمز عبور
      </Button>
    </form>
  );
}
