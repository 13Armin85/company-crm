import { useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, LayoutGrid, Plus } from "lucide-react";
import { AccessModal } from "../access/components";
import { api, errorMessage } from "../api";
import { Button } from "../components";
import { ErrorNotice } from "../error-state";
import { useNavigationDocument } from "../navigation";
import { categoryUrl } from "../navigation-paths";
import { useUIStore } from "../store";
import { enginePath, useEngineCatalog, useEngineSlug } from "./api";
import type { EntityDefinition } from "./api";

const VISIBLE_PAGES = 8;
const CODE_PATTERN = /^[a-z][a-z0-9-]{1,59}$/;

/** Tables built in the form designer; system tables already have their own menu items. */
export function customPages(entities: EntityDefinition[] = []) {
  return (
    entities
      .filter((entity) => !entity.parent && !entity.adapter && entity.is_active)
      // eslint-disable-next-line unicorn/no-array-sort -- filter creates a private array; support ES2022.
      .sort((a, b) => a.title.localeCompare(b.title, "fa"))
  );
}

export const suggestCode = () => `page-${Math.random().toString(36).slice(2, 7)}`;

export function NewPageDialog({ onClose, initialTitle = "" }: { onClose: () => void; initialTitle?: string }) {
  const slug = useEngineSlug();
  const client = useQueryClient();
  const navigate = useNavigate();
  const navigation = useNavigationDocument();
  const [category, setCategory] = useState(
    navigation?.categories.find((item) => item.id === "data")?.id ?? navigation?.categories[0]?.id ?? ""
  );
  const [title, setTitle] = useState(initialTitle);
  const [code, setCode] = useState(suggestCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const validCode = CODE_PATTERN.test(code);

  const create = async () => {
    setBusy(true);
    setError(null);
    const base = enginePath(slug);
    try {
      const created = (
        await api.post<{ to: string }>(`${base}/pages/`, {
          code,
          title: title.trim(),
          ...(category ? { category } : {}),
        })
      ).data;
      await client.invalidateQueries({ queryKey: ["entity-engine", slug] });
      await client.invalidateQueries({ queryKey: ["crm-navigation", slug] });
      useUIStore.getState().toast(`صفحهٔ «${title.trim()}» ساخته شد`);
      onClose();
      navigate(created.to);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccessModal title="ساخت صفحهٔ جدید" onClose={onClose} busy={busy}>
      <form
        className="sidebar-new-page"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() && validCode && !busy) void create();
        }}
      >
        <p>
          برای هر نوع اطلاعات یک صفحه بسازید؛ مثل قرارداد، فاکتور یا تأمین‌کننده. بعداً از «طراحی فرم‌ها و جدول‌ها» فیلدها و
          ارتباط‌هایش را اضافه کنید.
        </p>
        <label>
          نام صفحه
          <input
            required
            maxLength={255}
            value={title}
            placeholder="مثلاً قرارداد"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {navigation?.categories.length ? (
          <label>
            دسته‌بندی
            <select
              aria-label="دسته‌بندی صفحهٔ جدید"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {navigation.categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          کد انگلیسی
          <input
            required
            dir="ltr"
            aria-label="کد انگلیسی"
            maxLength={60}
            value={code}
            aria-invalid={!validCode}
            onChange={(event) => setCode(event.target.value.toLowerCase())}
          />
          <small>
            در آدرس صفحه استفاده می‌شود و بعداً قابل تغییر نیست؛ فقط حروف کوچک انگلیسی، عدد و خط تیره (مثلاً contract).
          </small>
        </label>
        <ErrorNotice message={error ? errorMessage(error, "ساخت صفحه انجام نشد.") : undefined} />
        <footer className="engine-actions">
          <Button type="submit" disabled={busy || !title.trim() || !validCode}>
            {busy ? "در حال ساخت…" : "ساخت صفحه"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            انصراف
          </Button>
        </footer>
      </form>
    </AccessModal>
  );
}

export function SidebarPages({
  canCreate,
  collapsed,
  onNavigate,
}: {
  canCreate: boolean;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const catalog = useEngineCatalog();
  const navigation = useNavigationDocument();
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const pages = customPages(catalog.data?.entities).filter(
    (page) => !navigation || navigation.entities.some((item) => item.code === page.code)
  );
  const allPagesTo = navigation?.categories.flatMap((item) => item.items).find((item) => item.path === "/entities")?.to;
  return (
    <div className="recent-projects sidebar-pages">
      <p>
        صفحه‌ها{" "}
        {canCreate && (
          <button type="button" aria-label="ساخت صفحهٔ جدید" title="ساخت صفحهٔ جدید" onClick={() => setCreating(true)}>
            <Plus size={14} />
          </button>
        )}
      </p>
      {pages.slice(0, expanded ? undefined : VISIBLE_PAGES).map((page) => (
        <NavLink
          key={page.code}
          to={categoryUrl(navigation, `/entities/${page.code}`)}
          title={collapsed ? page.title : undefined}
          onClick={onNavigate}
        >
          <FileText size={15} aria-hidden="true" />
          <span>{page.title}</span>
        </NavLink>
      ))}
      {allPagesTo ? (
        <NavLink to={allPagesTo} end title={collapsed ? "همه صفحه‌ها" : undefined} onClick={onNavigate}>
          <LayoutGrid size={15} aria-hidden="true" />
          <span>همه صفحه‌ها</span>
        </NavLink>
      ) : pages.length > VISIBLE_PAGES ? (
        <button
          type="button"
          className="sidebar-pages-empty"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <LayoutGrid size={15} aria-hidden="true" />
          <span>{expanded ? "نمایش کمتر" : `همه صفحه‌ها (${pages.length.toLocaleString("fa-IR")})`}</span>
        </button>
      ) : null}
      {!pages.length && !canCreate && <p className="shell-empty">صفحهٔ سفارشی در دسترس نیست.</p>}
      {!pages.length && canCreate && (
        <button type="button" className="sidebar-pages-empty" onClick={() => setCreating(true)}>
          <Plus size={15} aria-hidden="true" />
          <span>اولین صفحه را بسازید</span>
        </button>
      )}
      {creating && <NewPageDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
