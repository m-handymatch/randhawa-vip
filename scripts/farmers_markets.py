"""Builds public/data/farmers-markets/{ST}.json from the USDA National Farmers
Market Directory (USDA AMS Local Food Portal, public "download by directory"
export). Each file is a list of markets with name, address, lat/lon, season and
schedule text, and a website when listed. Runs from a GitHub Action."""
import csv, io, json, os, re, sys, time, urllib.request, zipfile

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data", "farmers-markets")
URLS = [
    "https://www.usdalocalfoodportal.com/api/download_by_directory/?directory=farmersmarket",
    "https://www.usdalocalfoodportal.com/api/download_by_directory?directory=farmersmarket",
]
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*",
                                               "Referer": "https://www.usdalocalfoodportal.com/"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.headers.get("content-type", ""), r.read()


def rows_from(ctype, data):
    if data[:2] == b"PK":  # zip or xlsx
        z = zipfile.ZipFile(io.BytesIO(data))
        names = z.namelist()
        if any(n.startswith("xl/") for n in names):
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True)
            ws = wb.active
            it = ws.iter_rows(values_only=True)
            head = [str(h or "").strip() for h in next(it)]
            return [dict(zip(head, r)) for r in it]
        inner = next(n for n in names if n.lower().endswith((".csv", ".json", ".xlsx")))
        return rows_from("", z.read(inner))
    txt = data.decode("utf-8-sig", "replace").lstrip()
    if txt.startswith("[") or txt.startswith("{"):
        j = json.loads(txt)
        if isinstance(j, dict):
            j = next((v for v in j.values() if isinstance(v, list)), [])
        return j
    return list(csv.DictReader(io.StringIO(txt)))


def pick(row, *keys):
    low = {str(k).lower().strip(): v for k, v in row.items()}
    for k in keys:
        v = low.get(k)
        if v not in (None, ""):
            return str(v).strip()
    return ""


def clean(s, n=400):
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = re.sub(r"\s+", " ", s).strip()
    return s[:n]


def main():
    data = None
    for u in URLS:
        try:
            ctype, data = fetch(u)
            print("OK", u, ctype, len(data), data[:200])
            break
        except Exception as e:  # noqa
            print("FAIL", u, e)
            time.sleep(3)
    if not data:
        sys.exit(1)
    rows = rows_from(ctype, data)
    print("rows", len(rows))
    if rows:
        print("columns", list(rows[0].keys()))
    by_state = {}
    for r in rows:
        try:
            lat = float(pick(r, "location_y", "latitude", "y", "lat"))
            lon = float(pick(r, "location_x", "longitude", "x", "lon", "lng"))
        except ValueError:
            continue
        if not (-90 < lat < 90 and -180 < lon < 180) or (lat == 0 and lon == 0):
            continue
        st = pick(r, "location_state", "state").upper()[:2]
        if len(st) != 2:
            continue
        m = {
            "name": clean(pick(r, "listing_name", "market_name", "marketname", "name"), 120),
            "street": clean(pick(r, "location_street", "street", "address"), 140),
            "city": clean(pick(r, "location_city", "city"), 60),
            "zip": pick(r, "location_zipcode", "zipcode", "zip")[:5],
            "lat": round(lat, 5), "lon": round(lon, 5),
            "when": clean(pick(r, "season1date", "operating_times", "season", "season_dates"), 160),
            "hours": clean(pick(r, "season1time", "hours", "schedule"), 200),
            "site": pick(r, "media_website", "website", "url"),
            "updated": pick(r, "updatetime", "update_date", "updated")[:10],
        }
        if not m["name"]:
            continue
        by_state.setdefault(st, []).append(m)
    if sum(len(v) for v in by_state.values()) < 500:
        print("Too few markets parsed; not writing.")
        sys.exit(1)
    os.makedirs(OUT, exist_ok=True)
    for st, ms in by_state.items():
        ms.sort(key=lambda m: (m["city"], m["name"]))
        with open(os.path.join(OUT, f"{st}.json"), "w") as f:
            json.dump({"source": "USDA National Farmers Market Directory", "markets": ms}, f,
                      separators=(",", ":"))
    print({k: len(v) for k, v in sorted(by_state.items())})


if __name__ == "__main__":
    main()
