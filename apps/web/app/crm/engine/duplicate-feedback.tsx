import { ErrorNotice } from "../error-state";
import { Link } from "react-router";

export type DuplicateDetail = { message: string; record_url?: string | null; inactive?: boolean };

export function duplicateDetails(error: unknown): DuplicateDetail[] {
  const duplicates = (error as { response?: { data?: { duplicates?: unknown } } })?.response?.data?.duplicates;
  return Array.isArray(duplicates)
    ? duplicates.filter((item): item is DuplicateDetail =>
        Boolean(item && typeof item === "object" && typeof item.message === "string")
      )
    : [];
}

export function DuplicateFeedback({ details }: { details: DuplicateDetail[] }) {
  if (!details.length) return null;
  const links = details.filter((detail) => detail.record_url?.startsWith("/entities/"));
  return (
    <>
      <ErrorNotice
        message={details.map((detail) => detail.message + (detail.inactive ? " (رکورد غیرفعال)" : "")).join("؛ ")}
      />
      {links.length > 0 && (
        <p className="duplicate-links">
          {links.map((detail) => (
            <Link key={detail.record_url} to={detail.record_url!}>
              مشاهده رکورد مشابه
            </Link>
          ))}
        </p>
      )}
    </>
  );
}
