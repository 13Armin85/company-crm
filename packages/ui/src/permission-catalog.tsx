import { useId, useState } from "react";
import { ArrowLeftRight, LockKeyhole, Search, ShieldCheck, X } from "lucide-react";

export type PermissionCatalogItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  isActive: boolean;
  isDelegatable: boolean;
};

const normalize = (value: string) =>
  value
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F]/g, "")
    .replace(/\u200c/g, " ")
    .trim()
    .toLowerCase();
const toFa = (value: number) => value.toLocaleString("fa-IR");

export function filterPermissionCatalog(items: PermissionCatalogItem[], query: string, category = "") {
  const search = normalize(query);
  return items.filter(
    (item) =>
      (!category || item.category === category) &&
      normalize([item.name, item.description, item.category].join(" ")).includes(search)
  );
}

export function PermissionCatalog({
  items,
  isLoading = false,
  hasError = false,
}: {
  items: PermissionCatalogItem[];
  isLoading?: boolean;
  hasError?: boolean;
}) {
  const headingId = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const categories = [...new Set(items.map((item) => item.category))];
  const filtered = filterPermissionCatalog(items, query, category);
  const visibleCategories = [...new Set(filtered.map((item) => item.category))];
  return (
    <section className="panel permission-catalog" aria-labelledby={headingId}>
      <header className="permission-catalog-header">
        <span className="permission-catalog-icon" aria-hidden="true">
          <ShieldCheck size={22} />
        </span>
        <div>
          <h2 id={headingId}>فهرست مجوزها</h2>
          <p>مجوزها مشخص می‌کنند هر نقش چه کارهایی می‌تواند انجام دهد. برای تغییر دسترسی‌ها، نقش را ویرایش کنید.</p>
        </div>
        <span className="permission-readonly">
          <LockKeyhole size={14} aria-hidden="true" /> فقط خواندنی
        </span>
      </header>
      <div className="permission-catalog-toolbar">
        <label className="permission-catalog-search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">جستجوی مجوزها</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="جستجوی نام یا توضیح مجوز…"
          />
          {query && (
            <button type="button" aria-label="پاک کردن جستجوی مجوزها" onClick={() => setQuery("")}>
              <X size={16} />
            </button>
          )}
        </label>
        <p className="permission-catalog-count" role="status">
          {toFa(filtered.length)} مجوز در {toFa(visibleCategories.length)} بخش
        </p>
      </div>
      <nav className="permission-categories" aria-label="دسته‌بندی مجوزها">
        <button type="button" aria-pressed={!category} onClick={() => setCategory("")}>
          همه بخش‌ها <span>{toFa(items.length)}</span>
        </button>
        {categories.map((name) => (
          <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(name)}>
            {name}
            <span>{toFa(items.filter((item) => item.category === name).length)}</span>
          </button>
        ))}
      </nav>
      {isLoading ? (
        <p className="permission-catalog-empty" role="status">
          در حال دریافت مجوزها…
        </p>
      ) : hasError ? (
        <p className="permission-catalog-empty" role="alert">
          دریافت مجوزها انجام نشد. دوباره تلاش کنید.
        </p>
      ) : filtered.length === 0 ? (
        <div className="permission-catalog-empty" role="status">
          <Search size={24} aria-hidden="true" />
          <strong>{items.length ? "مجوزی با این مشخصات پیدا نشد." : "مجوزی برای نمایش وجود ندارد."}</strong>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setCategory("");
              }}
            >
              نمایش همه مجوزها
            </button>
          )}
        </div>
      ) : (
        visibleCategories.map((name) => (
          <section className="permission-group" key={name} aria-label={"مجوزهای " + name}>
            <header className="permission-group-heading">
              <h3>{name}</h3>
              <span>{toFa(filtered.filter((item) => item.category === name).length)} مجوز</span>
            </header>
            <div className="permission-grid">
              {filtered
                .filter((item) => item.category === name)
                .map((item) => (
                  <article className="permission-card" key={item.id}>
                    <h4>{item.name}</h4>
                    <p>{item.description}</p>
                    <footer>
                      <span className={"permission-transfer " + (item.isDelegatable ? "is-delegatable" : "")}>
                        {item.isDelegatable ? (
                          <ArrowLeftRight size={14} aria-hidden="true" />
                        ) : (
                          <LockKeyhole size={14} aria-hidden="true" />
                        )}
                        {item.isDelegatable ? "قابل واگذاری به جانشین" : "ویژه صاحب نقش"}
                      </span>
                      {!item.isActive && <span className="permission-inactive">غیرفعال</span>}
                    </footer>
                  </article>
                ))}
            </div>
          </section>
        ))
      )}
    </section>
  );
}
