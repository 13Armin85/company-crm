import { useState } from "react";
import { RefreshCw, Search, UsersRound } from "lucide-react";
import { ErrorState } from "../error-state";
import { errorMessage } from "../api";
import { toFa } from "../utils";
import { useTeamData } from "./api";
import "../../../styles/team.css";

/** A directory of active workspace members, available only to administrators. */
export function TeamWidget() {
  const [search, setSearch] = useState("");
  const [unit, setUnit] = useState("");
  const data = useTeamData({ sort: "name" });
  const members = data.data?.cards ?? [];
  const cards = members.filter(
    (card) => (!unit || card.unit_id === unit) && card.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  );
  const units = [...new Map(members.filter((card) => card.unit_id).map((card) => [card.unit_id, card.unit])).entries()];

  if (data.isLoading)
    return (
      <div className="dashboard-widget-skeleton">
        <span />
        <span />
        <span />
      </div>
    );
  if (data.isError)
    return (
      <ErrorState
        message={errorMessage(data.error, "دریافت اعضای سامانه انجام نشد")}
        onRetry={() => void data.refetch()}
      />
    );

  return (
    <div className="team-directory" dir="rtl">
      <div className="team-directory-header">
        <div>
          <span className="team-directory-eyebrow">
            <UsersRound size={16} /> اعضای سامانه
          </span>
          <h3>{toFa(members.length)} نفر</h3>
          <p>فهرست کاربران فعال سامانه</p>
        </div>
        <button
          type="button"
          className="team-refresh"
          disabled={data.isFetching}
          onClick={() => void data.refetch()}
          aria-label="به‌روزرسانی اعضا"
        >
          <RefreshCw size={16} className={data.isFetching ? "team-refresh-spin" : undefined} aria-hidden="true" />
          به‌روزرسانی
        </button>
      </div>
      <div className="team-directory-filters">
        <label className="team-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">جستجوی اعضا</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جستجوی نام عضو…" />
        </label>
        <select aria-label="فیلتر واحد" value={unit} onChange={(event) => setUnit(event.target.value)}>
          <option value="">همه واحدها</option>
          {units.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>
      {cards.length ? (
        <div className="team-directory-grid">
          {cards.map((card) => (
            <article className="team-directory-card" key={card.id}>
              <span className="team-directory-avatar" aria-hidden="true">
                {card.avatar ? <img src={card.avatar} alt="" /> : card.name.slice(0, 1)}
              </span>
              <div>
                <strong>{card.name}</strong>
                <span>{card.position || "عضو سامانه"}</span>
                {card.unit && <small>{card.unit}</small>}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="team-directory-empty">عضوی با این مشخصات پیدا نشد.</p>
      )}
    </div>
  );
}
