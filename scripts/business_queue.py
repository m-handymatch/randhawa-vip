"""Works off the business_areas queue: asks the site which areas need loading
(members' home ZIPs and nearby cities), extracts each 0.25-degree square from
Overture Maps Places and sends it to the businesses-import function.

Proves it's this repo's workflow with a GitHub OIDC token; no stored secrets."""
import csv, gzip, io, json, os, sys, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from businesses import extract

FN = "https://pipzvzxcfvsxyiwmqpyv.supabase.co/functions/v1/businesses-import"
PART = 4000


def oidc():
    url = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"] + "&audience=localconnect-businesses"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})
    return json.load(urllib.request.urlopen(req))["value"]


def post(params, body=b"", ctype="application/json"):
    req = urllib.request.Request(FN + "?" + urllib.parse.urlencode(params), data=body, method="POST",
                                 headers={"Authorization": "Bearer " + oidc(), "content-type": ctype})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def send_area(tile, path):
    rows = list(csv.reader(open(path, newline="")))
    head, rows = rows[0], rows[1:]
    parts = [rows[i:i + PART] for i in range(0, len(rows), PART)] or [[]]
    for n, part in enumerate(parts):
        buf = io.StringIO()
        w = csv.writer(buf); w.writerow(head); w.writerows(part)
        res = post({"tile": tile, **({"final": "1"} if n == len(parts) - 1 else {})},
                   gzip.compress(buf.getvalue().encode()), "application/gzip")
        print(f"  part {n + 1}/{len(parts)}: {res}")


def main():
    limit = int(os.environ.get("AREAS", "3"))
    areas = post({"action": "claim", "limit": limit}).get("areas", [])
    print("areas to load:", [a["tile"] for a in areas])
    for a in areas:
        tile, s, w = a["tile"], a["south"], a["west"]
        bbox = f"{w},{s},{w + 0.25},{s + 0.25}"
        print("loading", tile, bbox)
        try:
            extract(bbox, "area.csv")
            send_area(tile, "area.csv")
        except Exception as e:  # noqa: BLE001
            print("failed:", e)
            post({"tile": tile, "failed": str(e)[:200]})


if __name__ == "__main__":
    main()
