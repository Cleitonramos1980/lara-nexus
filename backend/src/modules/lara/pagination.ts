import type { LaraPagedResult } from "./types.js";

function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor<T extends Record<string, unknown>>(cursor: string | undefined): T | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch {
    // noop
  }
  return null;
}

export function paginateRows<T>(
  rows: T[],
  pageSizeRaw: number | undefined,
  cursorRaw: string | undefined,
  filterByCursor: (row: T, cursor: Record<string, unknown>) => boolean,
  makeCursor: (row: T) => Record<string, unknown>,
): LaraPagedResult<T> {
  const pageSize = Number.isFinite(Number(pageSizeRaw))
    ? Math.max(1, Math.min(1000, Math.trunc(Number(pageSizeRaw))))
    : 100;

  const cursor = decodeCursor<Record<string, unknown>>(cursorRaw);
  const filtered = cursor ? rows.filter((row) => filterByCursor(row, cursor)) : rows;
  const page = filtered.slice(0, pageSize);
  const hasMore = filtered.length > page.length;
  const nextCursor = hasMore && page.length > 0 ? encodeCursor(makeCursor(page[page.length - 1])) : null;

  return {
    items: page,
    next_cursor: nextCursor,
    has_more: hasMore,
    page_size: pageSize,
  };
}
