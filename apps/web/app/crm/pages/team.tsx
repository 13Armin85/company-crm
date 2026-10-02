import { useMemo, useState } from "react";
import { KeyRound, MoreHorizontal, ShieldCheck, UserPlus, Users } from "lucide-react";
import { Link, Navigate } from "react-router";
import {
  useCreateWorkspaceUser,
  useCurrentUser,
  useMembers,
  useProjectMemberCounts,
  useRemoveMember,
  useUpdateMemberRole,
  useWorkspaceAccess,
} from "../api";
import { Avatar, Button, EmptyState, PageHeader, SearchBox, Skeleton } from "../components";
import { useUIStore } from "../store";
import { toFa } from "../utils";

export default function TeamPage() {
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState<15 | 20>(15);
  const [openMenu, setOpenMenu] = useState<string>();
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const { data: members = [], isLoading } = useMembers();
  const { data: currentUser } = useCurrentUser();
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const { data: projectCounts = {} } = useProjectMemberCounts();
  const createUser = useCreateWorkspaceUser(slug);
  const updateRole = useUpdateMemberRole(slug);
  const removeMember = useRemoveMember(slug);
  const canManageUsers = access?.isAdmin === true;
  const filtered = useMemo(
    () => members.filter((member) => member.displayName.includes(query) || member.email.includes(query)),
    [members, query]
  );
  if (accessLoading) return <Skeleton rows={6} />;
  if (!canManageUsers) return <Navigate to="/my-work" replace />;
  return (
    <div>
      <PageHeader
        eyebrow="فضای کاری"
        title="اعضای تیم"
        description={`${toFa(members.length)} نفر در کنار هم روی پروژه‌ها کار می‌کنند`}
        actions={
          canManageUsers ? (
            <Button icon={UserPlus} onClick={() => setInviteOpen(true)}>
              ساخت کاربر جدید
            </Button>
          ) : undefined
        }
      />
      {inviteOpen && (
        <form
          className="panel invite-form"
          onSubmit={(event) => {
            event.preventDefault();
            createUser.mutate(
              { email, username, password, display_name: displayName, role: newRole },
              {
                onSuccess: () => {
                  setEmail("");
                  setDisplayName("");
                  setUsername("");
                  setPassword("");
                  setNewRole(15);
                  setInviteOpen(false);
                },
              }
            );
          }}
        >
          <label>
            <span>نام نمایشی</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
          </label>
          <label>
            <span>ایمیل ورود</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              required
            />
          </label>
          <label>
            <span>نام کاربری</span>
            <input
              type="text"
              dir="ltr"
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_.-]{3,32}"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="armin.tavakoli"
              required
            />
          </label>
          <label>
            <span>رمز عبور اولیه</span>
            <input
              type="password"
              dir="ltr"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <label>
            <span>سطح دسترسی</span>
            <select value={newRole} onChange={(event) => setNewRole(Number(event.target.value) as 15 | 20)}>
              <option value={15}>کاربر عادی</option>
              <option value={20}>مدیر</option>
            </select>
          </label>
          <Button type="submit" icon={UserPlus} disabled={createUser.isPending}>
            ساخت حساب
          </Button>
          <Button variant="secondary" onClick={() => setInviteOpen(false)}>
            انصراف
          </Button>
        </form>
      )}
      <section className="team-stats">
        <article>
          <span>
            <Users size={20} />
          </span>
          <div>
            <strong>{toFa(members.length)}</strong>
            <p>همه اعضا</p>
          </div>
        </article>
        <article>
          <span className="admin">
            <ShieldCheck size={20} />
          </span>
          <div>
            <strong>{toFa(members.filter((m) => m.role === "مدیر").length)}</strong>
            <p>مدیر فضای کاری</p>
          </div>
        </article>
        <article>
          <span className="pending">
            <KeyRound size={20} />
          </span>
          <div>
            <strong>{toFa(members.filter((member) => member.role !== "مدیر").length)}</strong>
            <p>کاربر عادی</p>
          </div>
        </article>
      </section>
      <div className="table-card team-table">
        <div className="table-toolbar">
          <h2>فهرست اعضا</h2>
          <SearchBox value={query} onChange={setQuery} placeholder="جستجوی نام یا ایمیل..." />
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
                <th>نقش</th>
                <th>پروژه‌ها</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((member) => (
                <tr key={member.id}>
                  <td>
                    <div className="member-cell">
                      <Avatar member={member} />
                      <div>
                        <Link className="member-profile-link" to={`/team/${member.id}`}>
                          <b>{member.displayName}</b>
                        </Link>
                        <small>{member.email}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <select
                      className="role-select"
                      value={member.role}
                      disabled={!canManageUsers || member.id === currentUser?.id}
                      onChange={(event) =>
                        member.membershipId &&
                        updateRole.mutate({
                          membershipId: member.membershipId,
                          role: event.target.value === "مدیر" ? 20 : 15,
                        })
                      }
                    >
                      <option value="مدیر">مدیر</option>
                      <option value="عضو">عضو</option>
                    </select>
                  </td>
                  <td>{toFa(projectCounts[member.id] ?? 0)} پروژه</td>
                  <td>
                    {canManageUsers && member.id !== currentUser?.id && (
                      <button
                        className="plain-icon"
                        onClick={() => setOpenMenu(openMenu === member.id ? undefined : member.id)}
                      >
                        <MoreHorizontal size={18} />
                      </button>
                    )}
                    {canManageUsers && openMenu === member.id && (
                      <div className="action-menu team-action-menu">
                        <button
                          onClick={() => {
                            if (member.membershipId && window.confirm(`حذف ${member.displayName} از شرکت؟`))
                              removeMember.mutate(member.membershipId);
                            setOpenMenu(undefined);
                          }}
                        >
                          حذف از شرکت
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
