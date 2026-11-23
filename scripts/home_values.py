"""Build small per-state home value files from Zillow Research's public ZHVI CSVs.

Zillow Home Value Index (ZHVI): typical home value (all homes, middle tier, smoothed, seasonally adjusted).
Data: Zillow Research, https://www.zillow.com/research/data/ (free to use with clear attribution to Zillow).

Writes public/data/home-values/<ST>.json:
  {"month": "2026-10", "zips": {"94538": [1520000, 3.1], ...}, "cities": {"fremont": [1490000, 2.8], ...}}
where each pair is [typical value in dollars, % change over the last 12 months].
"""
import csv, json, os, sys, urllib.request, io, re
from collections import defaultdict

BASE = "https://files.zillowstatic.com/research/public_csvs/zhvi/"
FILES = {
    "zips": "Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    "cities": "City_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
}
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data", "home-values")

def rows(name):
    req = urllib.request.Request(BASE + name, headers={"User-Agent": "localconnect.site home values (GitHub Actions)"})
    with urllib.request.urlopen(req, timeout=300) as res:
        yield from csv.reader(io.TextIOWrapper(res, encoding="utf-8", newline=""))

def latest_pair(cells, date_idx):
    """Latest value and % change vs 12 months earlier (skipping blank months at the end)."""
    for k in range(len(date_idx) - 1, 11, -1):
        now = cells[date_idx[k]]
        if now:
            then = cells[date_idx[k - 12]]
            v = float(now)
            chg = round((v / float(then) - 1) * 100, 1) if then and float(then) > 0 else None
            return k, round(v, -3), chg
    return None

def main():
    by_state = defaultdict(lambda: {"zips": {}, "cities": {}})
    month = None
    for kind, name in FILES.items():
        it = rows(name)
        header = next(it)
        col = {h: i for i, h in enumerate(header)}
        date_idx = [i for i, h in enumerate(header) if re.match(r"^\d{4}-\d{2}-\d{2}$", h)]
        n = 0
        for cells in it:
            st = cells[col["State"]].strip()
            region = cells[col["RegionName"]].strip()
            if len(st) != 2 or not region:
                continue
            got = latest_pair(cells, date_idx)
            if not got:
                continue
            k, v, chg = got
            month = max(month or "", header[date_idx[k]][:7])
            key = region.zfill(5) if kind == "zips" else region.lower()
            by_state[st][kind][key] = [int(v), chg]
            n += 1
        print(f"{kind}: {n} regions", file=sys.stderr)
    if not by_state:
        sys.exit("No data parsed; leaving files unchanged")
    os.makedirs(OUT, exist_ok=True)
    for st, data in by_state.items():
        with open(os.path.join(OUT, f"{st}.json"), "w") as f:
            json.dump({"month": month, "source": "Zillow Home Value Index (ZHVI), Zillow Research", **data}, f, separators=(",", ":"), sort_keys=True)
    print(f"wrote {len(by_state)} states, month {month}", file=sys.stderr)

if __name__ == "__main__":
    main()
