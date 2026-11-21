"""Extracts businesses from Overture Maps Places (CDLA Permissive 2.0) for a
bounding box and writes businesses.csv (one row per place, US addresses only).
Runs from a GitHub Action; the CSV is uploaded as a workflow artifact (not
committed) and loaded into the admin-only Supabase table `businesses`.

BBOX env: "west,south,east,north" (longitude/latitude)."""
import csv, json, os, subprocess, sys
import duckdb

def extract(bbox, out="businesses.csv"):
  """Writes the businesses inside bbox ("west,south,east,north") to out; returns the row count."""
  subprocess.run([sys.executable, "-m", "overturemaps.cli", "download", f"--bbox={bbox}",
                  "-f", "geoparquet", "--type=place", "-o", "places.parquet"], check=True)
  return _write(out)


def _write(out):
  con = duckdb.connect()
  con.execute("INSTALL spatial; LOAD spatial;")
  cols = [r[0] for r in con.execute("DESCRIBE SELECT * FROM 'places.parquet'").fetchall()]
  print("columns:", cols)

  rows = con.execute("""
    SELECT id,
           names.primary AS name,
           """ + ("basic_category" if "basic_category" in cols else "categories.primary") + """ AS category,
           addresses[1].freeform AS street,
           addresses[1].locality AS city,
           addresses[1].region AS state,
           addresses[1].postcode AS postcode,
           addresses[1].country AS country,
           ST_Y(geometry) AS lat, ST_X(geometry) AS lon,
           websites, phones, emails, socials,
           confidence,
           """ + ("operating_status" if "operating_status" in cols else "NULL") + """ AS status
    FROM 'places.parquet'
  """).fetchall()

  def first(v):
      return (v[0] if v else "") or ""

  out_count = 0
  with open(out, "w", newline="") as f:
      w = csv.writer(f)
      w.writerow(["id", "name", "category", "street", "city", "state", "zip", "lat", "lon",
                  "website", "phone", "email", "socials", "confidence", "status"])
      for (id_, name, cat, street, city, state, pc, country, lat, lon, webs, phones, emails, socials, conf, status) in rows:
          if not name or (country and country != "US"):
              continue
          if status in ("permanently_closed",):
              continue
          z = (pc or "")[:5]
          w.writerow([id_, name, cat or "", street or "", city or "", (state or "").replace("US-", ""), z,
                      round(lat, 6), round(lon, 6), first(webs), first(phones), first(emails),
                      json.dumps(list(socials or []))[:500], round(conf or 0, 3), status or ""])
          out_count += 1
  print("businesses:", out_count)
  import collections
  rows_out = list(csv.DictReader(open(out)))
  print("with email:", sum(1 for r in rows_out if r["email"]), " website:", sum(1 for r in rows_out if r["website"]),
        " phone:", sum(1 for r in rows_out if r["phone"]))
  print("top cities:", collections.Counter(r["city"] for r in rows_out).most_common(12))
  print("top categories:", collections.Counter(r["category"] for r in rows_out).most_common(25))
  return out_count


if __name__ == "__main__":
  extract(os.environ.get("BBOX", "-122.80,37.88,-122.45,38.32"))
