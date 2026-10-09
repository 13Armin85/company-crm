import { useMemo, useState } from "react";
import { PasswordInput } from "@plane/ui";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { Link, Navigate } from "react-router";
import { useCreateWorkspaceUser, useMembers, useOrganizationRoles, useWorkspaceAccess, errorMessage } from "../api";
import { useAccessMutation } from "../access/api";
import { AccessModal, MultiSelector, passwordError } from "../access/components";
import { Avatar, Button, EmptyState, PageHeader, SearchBox, Skeleton } from "../components";
import { useUIStore } from "../store";
import type { Member } from "../types";
import { toFa } from "../utils";

export function UserActionItems({
  member,
  can,
  onChangePassword,
  onRemove,
}: {
  member: Member;
  can: (code: string) => boolean;
  onChangePassword: (member: Member) => void;
  onRemove: (member: Member) => void;
}) {
  return (
    <>
      {["User.Edit", "User.Role.Assign", "OrganizationUnit.Member.Manage"].some(can) && (
        <MenuItem as={Link} to={`/team/${member.id}`}>
          تغییر اطلاعات هویتی
        </MenuItem>
      )}
      {can("User.ChangePassword") && (
        <MenuItem as="button" type="button" onClick={() => onChangePassword(member)}>
          تغییر رمز عبور
        </MenuItem>
      )}
      {can("User.Delete") && (
        <MenuItem as="button" type="button" onClick={() => onRemove(member)}>
          حذف کاربر
        </MenuItem>
      )}
    </>
  );
}

export default function TeamPage() {
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    email: "",
    display_name: "",
    username: "",
    password: "",
    role_ids: [] as string[],
  });
  const [passwordUser, setPasswordUser] = useState<Member>();
  const [removeUser, setRemoveUser] = useState<Member>();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const { data: members = [], isLoading, error } = useMembers();
  const { data: roles = [] } = useOrganizationRoles(undefined, access?.can("User.Role.Assign") ?? false);
  const createUser = useCreateWorkspaceUser(slug);
  const mutation = useAccessMutation();
  const filtered = useMemo(
    () =>
      members.filter((member) => `${member.displayName} ${member.email}`.toLowerCase().includes(query.toLowerCase())),
    [members, query]
  );
  const closePassword = () => {
    mutation.reset();
    setPasswordUser(undefined);
    setPassword("");
    setConfirmation("");
  };
  if (accessLoading) return <Skeleton rows={6} />;
  if (!access?.can("User.View")) return <Navigate to="/my-work" replace />;
  return (
    <div>
      <PageHeader
        eyebrow="فضای کاری"
        title="اعضای تیم"
        description={`${toFa(members.length)} عضو در شرکت`}
        actions={
          access.can("User.Create") && (
            <Button icon={UserPlus} onClick={() => setCreateOpen(true)}>
              ساخت کاربر جدید
            </Button>
          )
        }
      />
      {error && <p role="alert">دریافت اعضا انجام نشد.</p>}
      <div className="table-card team-table">
        <div className="table-toolbar">
          <h2>فهرست اعضا</h2>
          <SearchBox value={query} onChange={setQuery} placeholder="جستجوی نام یا ایمیل…" />
        </div>
        {isLoading ? (
          <Skeleton rows={5} />
        ) : !filtered.length ? (
          <EmptyState title="عضوی پیدا نشد" description="نام یا ایمیل دیگری را جستجو کنید." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>عضو</th>
                <th>نقش‌های سازمانی</th>
                <th>وضعیت</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((member) => (
                <tr key={member.id}>
                  <td>
                    <div className="member-cell">
                      <Avatar member={member} />
                      <div>
                        <Link to={`/team/${member.id}`}>{member.displayName}</Link>
                        <small dir="ltr">{member.email}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="role-chips">
                      {member.roles?.map((role) => (
                        <span key={role.id}>{role.name}</span>
                      ))}
                    </div>
                  </td>
                  <td>{member.isActive === false ? "غیرفعال" : "فعال"}</td>
                  <td>
                    {[
                      "User.Edit",
                      "User.Role.Assign",
                      "OrganizationUnit.Member.Manage",
                      "User.ChangePassword",
                      "User.Delete",
                    ].some(access.can) && (
                      <Menu as="div" className="team-menu">
                        <MenuButton className="plain-icon" aria-label={`عملیات ${member.displayName}`}>
                          <MoreHorizontal size={18} />
                        </MenuButton>
                        <MenuItems className="action-menu team-action-menu">
                          <UserActionItems
                            member={member}
                            can={access.can}
                            onChangePassword={(selectedMember) => {
                              mutation.reset();
                              setPasswordUser(selectedMember);
                            }}
                            onRemove={setRemoveUser}
                          />
                        </MenuItems>
                      </Menu>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {createOpen && (
        <AccessModal
          title="ساخت کاربر جدید"
          busy={createUser.isPending}
          onClose={() => {
            setCreateOpen(false);
            setForm({ email: "", username: "", display_name: "", password: "", role_ids: [] });
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              createUser.mutate(
                {
                  ...form,
                  role_ids: access.can("User.Role.Assign") && form.role_ids.length ? form.role_ids : undefined,
                },
                {
                  onSuccess: () => {
                    setCreateOpen(false);
                    setForm({ email: "", username: "", display_name: "", password: "", role_ids: [] });
                  },
                }
              );
            }}
          >
            <label>
              <span>نام نمایشی</span>
              <input
                required
                value={form.display_name}
                onChange={(event) => setForm({ ...form, display_name: event.target.value })}
              />
            </label>
            <label>
              <span>ایمیل</span>
              <input
                required
                type="email"
                dir="ltr"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>
            <label>
              <span>نام کاربری</span>
              <input
                required
                dir="ltr"
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9_.-]{3,32}"
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
              />
            </label>
            <label>
              <span>رمز عبور اولیه</span>
              <input
                required
                type="password"
                dir="ltr"
                minLength={8}
                autoComplete="new-password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            </label>
            <MultiSelector
              label="نقش‌ها"
              disabled={!access.can("User.Role.Assign")}
              selected={form.role_ids}
              onChange={(role_ids) => setForm({ ...form, role_ids })}
              options={roles
                .filter((role) => role.isActive)
                .map((role) => ({ id: role.id, title: role.name, description: role.description }))}
            />
            <footer>
              <Button type="submit" disabled={createUser.isPending}>
                ساخت حساب
              </Button>
            </footer>
          </form>
        </AccessModal>
      )}
      {passwordUser && (
        <AccessModal
          title={`تغییر رمز عبور ${passwordUser.displayName}`}
          busy={mutation.isPending}
          onClose={closePassword}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (passwordError(password, confirmation)) return;
              mutation.mutate(
                {
                  path: `users/${passwordUser.id}/password/`,
                  body: { new_password: password, confirm_password: confirmation },
                },
                { onSuccess: closePassword }
              );
            }}
          >
            <label htmlFor="crm-new-password">
              <span>رمز عبور جدید</span>
              <PasswordInput
                id="crm-new-password"
                required
                disabled={mutation.isPending}
                className="crm-password-input"
                placeholder=""
                toggleLabels={{ show: "نمایش رمز عبور", hide: "مخفی کردن رمز عبور" }}
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
              />
            </label>
            <label htmlFor="crm-confirm-password">
              <span>تأیید رمز عبور جدید</span>
              <PasswordInput
                id="crm-confirm-password"
                required
                disabled={mutation.isPending}
                className="crm-password-input"
                placeholder=""
                toggleLabels={{ show: "نمایش تأیید رمز عبور", hide: "مخفی کردن تأیید رمز عبور" }}
                autoComplete="new-password"
                value={confirmation}
                onChange={setConfirmation}
              />
            </label>
            {confirmation && passwordError(password, confirmation) && (
              <p role="alert">{passwordError(password, confirmation)}</p>
            )}
            {mutation.error && <p role="alert">{errorMessage(mutation.error, "تغییر رمز انجام نشد.")}</p>}
            <footer>
              <Button variant="secondary" disabled={mutation.isPending} onClick={closePassword}>
                انصراف
              </Button>
              <Button type="submit" disabled={mutation.isPending || Boolean(passwordError(password, confirmation))}>
                تغییر رمز عبور
              </Button>
            </footer>
          </form>
        </AccessModal>
      )}
      {removeUser && (
        <AccessModal title="حذف کاربر از شرکت" busy={mutation.isPending} onClose={() => setRemoveUser(undefined)}>
          <p>عضویت {removeUser.displayName} در این شرکت غیرفعال می‌شود. سوابق کارها حفظ خواهند شد.</p>
          <footer>
            <Button variant="secondary" disabled={mutation.isPending} onClick={() => setRemoveUser(undefined)}>
              انصراف
            </Button>
            <Button
              variant="danger"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate(
                  { path: `users/${removeUser.id}/membership/`, method: "delete" },
                  { onSuccess: () => setRemoveUser(undefined) }
                )
              }
            >
              حذف کاربر
            </Button>
          </footer>
        </AccessModal>
      )}
    </div>
  );
}
