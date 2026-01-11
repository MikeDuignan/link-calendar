import argparse
import datetime as dt
import json
import re
import sys
import urllib.error
import urllib.request

import pdfplumber

MONTHS = {
    "January": 1,
    "February": 2,
    "March": 3,
    "April": 4,
    "May": 5,
    "June": 6,
    "July": 7,
    "August": 8,
    "September": 9,
    "October": 10,
    "November": 11,
    "December": 12,
}


def extract_month_year(page) -> tuple[int, int] | None:
    text = page.extract_text() or ""
    match = re.search(
        r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})",
        text,
    )
    if not match:
        return None
    month = MONTHS[match.group(1)]
    year = int(match.group(2))
    return (year, month)


def extract_entries_from_page(page) -> dict[str, str]:
    month_year = extract_month_year(page)
    if not month_year:
        return {}
    year, month = month_year

    words = page.extract_words(extra_attrs=["size"])

    weekday_words = [w for w in words if w["text"] in {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}]
    if not weekday_words:
        return {}

    weekday_words = sorted(weekday_words, key=lambda w: w["top"])
    header_top = weekday_words[0]["top"]
    weekday_words = [w for w in weekday_words if abs(w["top"] - header_top) < 5]
    by_text = {w["text"]: w for w in weekday_words}

    centers = []
    for label in ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]:
        w = by_text.get(label)
        if not w:
            return {}
        centers.append((w["x0"] + w["x1"]) / 2)

    col_bounds = [centers[0] - (centers[1] - centers[0]) / 2]
    for i in range(6):
        col_bounds.append((centers[i] + centers[i + 1]) / 2)
    col_bounds.append(centers[6] + (centers[6] - centers[5]) / 2)

    def col_of(word) -> int | None:
        xc = (word["x0"] + word["x1"]) / 2
        for i in range(7):
            if col_bounds[i] <= xc < col_bounds[i + 1]:
                return i
        return None

    day_words = [w for w in words if w["text"].isdigit() and 1 <= int(w["text"]) <= 31]
    grid_day_words = [
        w
        for w in day_words
        if ((w["x0"] + w["x1"]) / 2) >= col_bounds[0] and w["top"] > header_top + 10
    ]
    if not grid_day_words:
        return {}

    grid_day_words = sorted(grid_day_words, key=lambda w: (w["top"], w["x0"]))

    row_tops: list[float] = []
    for w in grid_day_words:
        if not row_tops or abs(w["top"] - row_tops[-1]) > 6:
            row_tops.append(w["top"])

    row_starts = [t - 2 for t in row_tops]
    row_ends = [(row_tops[i + 1] - 2) if i + 1 < len(row_tops) else page.height for i in range(len(row_tops))]

    def row_of(word) -> int | None:
        y = word["top"]
        for i in range(len(row_tops)):
            if row_starts[i] <= y < row_ends[i]:
                return i
        return None

    day_by_cell: dict[tuple[int, int], int] = {}
    day_top_by_cell: dict[tuple[int, int], float] = {}
    for w in grid_day_words:
        r = row_of(w)
        c = col_of(w)
        if r is None or c is None:
            continue
        day = int(w["text"])
        key = (r, c)
        if key not in day_by_cell or w["top"] < day_top_by_cell[key]:
            day_by_cell[key] = day
            day_top_by_cell[key] = w["top"]

    ignored = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", str(year)}
    cell_words: dict[tuple[int, int], list[dict]] = {}
    for w in words:
        if w["text"] in ignored:
            continue
        xc = (w["x0"] + w["x1"]) / 2
        if xc < col_bounds[0] or xc >= col_bounds[-1]:
            continue
        if w["top"] < header_top + 10:
            continue
        r = row_of(w)
        c = col_of(w)
        if r is None or c is None:
            continue
        cell_words.setdefault((r, c), []).append(w)

    entries: dict[str, str] = {}
    for (r, c), day in day_by_cell.items():
        date = dt.date(year, month, day).isoformat()
        top_ref = day_top_by_cell[(r, c)]
        words_in = cell_words.get((r, c), [])

        filtered = []
        for w in words_in:
            if w["text"].isdigit() and int(w["text"]) == day and abs(w["top"] - top_ref) < 8:
                continue
            if w["text"].isdigit() and int(w["text"]) <= 53 and ((w["x0"] + w["x1"]) / 2) < col_bounds[0]:
                continue
            filtered.append(w)

        if not filtered:
            continue

        filtered = sorted(filtered, key=lambda w: (w["top"], w["x0"]))
        lines: list[str] = []
        current: list[dict] = []
        last_top: float | None = None
        for w in filtered:
            if last_top is None or abs(w["top"] - last_top) <= 3:
                current.append(w)
                last_top = w["top"] if last_top is None else (last_top + w["top"]) / 2
            else:
                lines.append(" ".join(x["text"] for x in current).strip())
                current = [w]
                last_top = w["top"]
        if current:
            lines.append(" ".join(x["text"] for x in current).strip())

        text = "\n".join([line for line in lines if line]).strip()
        if text:
            entries[date] = text

    return entries


def extract_entries(pdf_path: str) -> dict[str, str]:
    all_entries: dict[str, str] = {}
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for date, text in extract_entries_from_page(page).items():
                all_entries[date] = text
    return all_entries


def chunks(items: list[dict], size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
            raise RuntimeError(parsed.get("error") or body) from None
        except json.JSONDecodeError:
            raise RuntimeError(body or str(e)) from None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract dated items from the Academic Calendar PDF and import them into a Link Calendar (Vercel Postgres)."
    )
    parser.add_argument("--pdf", required=True, help="Path to the PDF file.")
    parser.add_argument("--base-url", required=True, help="Your deployed app URL, e.g. https://your-app.vercel.app")
    parser.add_argument("--calendar-id", required=True, help="Calendar key from the app (Calendar key button).")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be imported, without calling the API.")
    args = parser.parse_args()

    entries_by_date = extract_entries(args.pdf)
    items = [{"date": d, "title": t, "url": ""} for d, t in sorted(entries_by_date.items())]

    print(f"Extracted {len(items)} dated item(s).", file=sys.stderr)
    if args.dry_run:
        print(json.dumps({"entries": items[:5], "total": len(items)}, indent=2))
        return 0

    endpoint = args.base_url.rstrip("/") + "/api/entries"
    for batch in chunks(items, 500):
        post_json(endpoint, {"calendarId": args.calendar_id, "entries": batch})
        print(f"Imported {len(batch)}…", file=sys.stderr)

    print("Done.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

