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


ADDR = re.compile(r",\s*([^,]+?),\s*([A-Za-z .]+?)\s+(\d{5})(?:-\d{4})?\s*$")
STATES = {n.lower(): c for n, c in [
    ("Alabama","AL"),("Alaska","AK"),("Arizona","AZ"),("Arkansas","AR"),("California","CA"),
    ("Colorado","CO"),("Connecticut","CT"),("Delaware","DE"),("District of Columbia","DC"),
    ("Florida","FL"),("Georgia","GA"),("Hawaii","HI"),("Idaho","ID"),("Illinois","IL"),
    ("Indiana","IN"),("Iowa","IA"),("Kansas","KS"),("Kentucky","KY"),("Louisiana","LA"),
    ("Maine","ME"),("Maryland","MD"),("Massachusetts","MA"),("Michigan","MI"),("Minnesota","MN"),
    ("Mississippi","MS"),("Missouri","MO"),("Montana","MT"),("Nebraska","NE"),("Nevada","NV"),
    ("New Hampshire","NH"),("New Jersey","NJ"),("New Mexico","NM"),("New York","NY"),
    ("North Carolina","NC"),("North Dakota","ND"),("Ohio","OH"),("Oklahoma","OK"),("Oregon","OR"),
    ("Pennsylvania","PA"),("Rhode Island","RI"),("South Carolina","SC"),("South Dakota","SD"),
    ("Tennessee","TN"),("Texas","TX"),("Utah","UT"),("Vermont","VT"),("Virginia","VA"),
    ("Washington","WA"),("West Virginia","WV"),("Wisconsin","WI"),("Wyoming","WY"),
    ("Puerto Rico","PR"),("Guam","GU"),("Virgin Islands","VI")]}


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
    by_state = {}
    for r in rows:
        try:
            lat = float(pick(r, "location_y"))
            lon = float(pick(r, "location_x"))
        except ValueError:
            continue
        if not (-90 < lat < 90 and -180 < lon < 180) or (lat == 0 and lon == 0):
            continue
        addr = clean(pick(r, "location_address"), 200)
        m_ = ADDR.search(addr)
        if not m_:
            continue
        city, state, zc = m_.group(1).strip(), m_.group(2).strip().lower(), m_.group(3)
        st = STATES.get(state) or (state.upper() if len(state) == 2 else "")
        if not st:
            continue
        street = addr[:m_.start()].strip(" ,")
        pay = pick(r, "fnap") + pick(r, "acceptedpayment")
        m = {
            "id": pick(r, "listing_id"),
            "name": clean(pick(r, "listing_name"), 120),
            "street": street[:140],
            "city": city[:60],
            "zip": zc,
            "lat": round(lat, 5), "lon": round(lon, 5),
            "about": clean(pick(r, "listing_desc"), 280),
            "where": clean(pick(r, "location_site"), 80).strip("; ").replace(";", ", "),
            "ebt": bool(re.search(r"SNAP|EBT", pay)),
            "organic": "Organic" in pick(r, "specialproductionmethods"),
            "updated": pick(r, "update_time")[:10],
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
