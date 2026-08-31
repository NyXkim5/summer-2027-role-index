#!/usr/bin/env python3
"""Daily refresh for the Summer 2027 role index.

Deterministic, no LLM. Sweeps every job board in sources.json, then edits
index.html in place:

  - roles that fell off their board get a "closed" tag, they are never deleted
  - new early-career postings get appended to the matching section
  - the refreshed-on date and the counts in the header are rewritten

Curated rows, prose, and hand-written tags are left alone. The script only
appends and only tags, so a human edit is never clobbered.

Run with --dry-run to print the diff without writing.
"""

import argparse
import concurrent.futures
import datetime
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HERE, "index.html")
SOURCES = os.path.join(HERE, "sources.json")
CHANGELOG = os.path.join(HERE, "CHANGELOG.md")

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
TIMEOUT = 30

# A posting has to look early-career and must not look senior.
EARLY = re.compile(
    r"\bintern\b|internship|\bnew ?grad|new graduate|new college grad|\bco-?op\b"
    r"|entry.?level|early career|university\b|campus|summer analyst|full time analyst"
    r"|graduate (program|engineer|analyst|scientist|manager|associate|developer)"
    r"|residency|research resident|apprentice|leadership development|pathways",
    re.I,
)
SENIOR = re.compile(
    r"\bsenior\b|\bsr\.?\b|principal|\bstaff\b|director|\bvp\b|vice president"
    r"|head of|manager,|\bii\b|\biii\b|\bmid\b|experienced|\bavp\b",
    re.I,
)
# Warehouse and shift work is early-career but not what this index is for.
JUNK = re.compile(
    r"warehouse|materials associate|inventory|shipping|receiving|forklift|janitor"
    r"|custodian|driver|line cook|barista|retail associate|security officer"
    r"|production associate|maintenance technician",
    re.I,
)
US = re.compile(
    r"\b(USA|United States|Remote|AL|AZ|CA|CO|CT|DC|FL|GA|IL|IN|IA|KS|MA|MD|MI|MN|MO"
    r"|NC|NJ|NM|NV|NY|OH|OK|OR|PA|SC|TN|TX|UT|VA|WA|WI)\b"
    r"|New York|San Francisco|Seattle|Chicago|Austin|Boston|Atlanta|Denver|Dallas"
    r"|Houston|Phoenix|Charlotte|McLean|Arlington|Sunnyvale|Palo Alto|Mountain View"
    r"|Bellevue|Redmond|Cupertino|San Jose|Los Angeles",
    re.I,
)

# Section routing. First rule that matches wins; order matters.
# (section heading fragment, company regex or None, title regex or None)
ROUTES = [
    ("<h2>Business, strategy &amp; operations", None,
     r"business (operation|development|analyst|strateg)|bizops|strategy|strategic"
     r"|chief of staff|\boperations\b|\bgtm\b|go.to.market|revenue operation"
     r"|partnership|growth|marketing|policy|corporate development|supply chain"
     r"|procurement|sourcing|finance|financial|accounting|legal|people |talent"),
    ("<h2>Product management</h2>", None,
     r"product manage|product market|product design|product owner|product analyst"
     r"|product develop|\bapm\b|program manage|product intern"),
    ("<h2>Analyst, strategy &amp; quant</h2>", None,
     r"quant|analyst|analytics|data scien|data engineer|business intelligence"
     r"|consult|actuar|economics|risk"),
    ("<h2>Defense &amp; national security",
     r"palantir|anduril|booz|caci|leidos|northrop|rtx|raytheon|l3harris|lockheed"
     r"|general dynamics|shield ai|skydio|saronic|neros|true anomaly|castelion"
     r"|hadrian|vannevar|govini|epirus|boeing|sierra nevada", None),
    ("<h2>Frontier tech, energy &amp; space",
     r"spacex|zipline|rocket lab|kairos|base power|nuclear|astranis|planet"
     r"|relativity|firefly|stoke|muon|umbra|capella|impulse|varda|applied intuition"
     r"|zoox|normal computing", None),
    ("<h2>AI research &amp; residencies", None,
     r"research (intern|scientist|resident)|residency|phd intern"),
    ("<h2>Engineering at notable product companies</h2>", None,
     r"software engineer|swe\b|programmer|developer|firmware|embedded|infrastructure"),
    ("<h2>Full-time &amp; new grad", None, r"new ?grad|new college grad|entry.?level|associate"),
]
FALLBACK = "<h2>Full-time &amp; new grad"


def fetch(url, post_body=None):
    cmd = ["curl", "-s", "-m", str(TIMEOUT), "-A", UA, url]
    if post_body is not None:
        cmd += ["-X", "POST", "-H", "Content-Type: application/json",
                "-H", "Accept: application/json", "-d", post_body]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True).stdout
        return json.loads(out) if out.strip() else None
    except (json.JSONDecodeError, OSError):
        return None


def ids_in(text):
    """Every job id we can recognise inside a URL or blob of HTML."""
    return set(re.findall(r"\d{6,}", text)) | set(
        re.findall(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", text)
    )


# Boards that serve Greenhouse under a company domain, so the token is not in
# the URL. Closure detection needs the mapping to know which board a row is from.
HOST_TOKEN = {
    "www.zipline.com": "flyzipline",
    "zipline.com": "flyzipline",
    "databricks.com": "databricks",
    "careers.datadoghq.com": "datadog",
    "careers.roblox.com": "roblox",
    "www.ixl.com": "ixllearning",
    "epicgames.com": "epicgames",
    "www.samsara.com": "samsara",
    "flatiron.com": "flatironhealth",
    "www.mongodb.com": "mongodb",
    "www.okta.com": "okta",
    "stripe.com": "stripe",
    "www.coinbase.com": "coinbase",
    "www.pinterestcareers.com": "pinterest",
}


def board_token(url):
    """Which board a row belongs to, or None if we cannot tell."""
    m = re.match(r"https?://([^/]+)(/[^?]*)", url)
    if not m:
        return None
    host, path = m.group(1), m.group(2)
    if "myworkdayjobs.com" in host or "myworkdaysite.com" in host:
        return None  # Workday is search-only, absence proves nothing
    m2 = re.match(r"/v1/boards/([^/]+)/", path) or re.match(r"/([^/]+)/jobs/", path)
    if "greenhouse.io" in host and m2:
        return m2.group(1)
    if "ashbyhq.com" in host:
        m3 = re.match(r"/([^/]+)/", path)
        return m3.group(1) if m3 else None
    if "lever.co" in host:
        m3 = re.match(r"/([^/]+)/", path)
        return m3.group(1) if m3 else None
    return HOST_TOKEN.get(host)


def sweep(sources):
    """Return (postings, live_ids, boards_ok, enumerated). postings are dicts, dated.

    `enumerated` is the set of board tokens we fully listed this run. Only rows
    belonging to those boards are eligible to be marked closed, because a board
    we failed to reach, or a search-only API like Workday, cannot prove absence.
    """
    jobs, live, ok = [], set(), 0
    enumerated = set()

    def greenhouse(tok):
        d = fetch(f"https://boards-api.greenhouse.io/v1/boards/{tok}/jobs")
        if not d or "jobs" not in d:
            return None
        out = []
        for j in d["jobs"]:
            out.append({
                "date": (j.get("first_published") or j.get("updated_at") or "")[:10],
                "title": (j.get("title") or "").strip(),
                "loc": ((j.get("location") or {}).get("name") or "").strip(),
                "url": j["absolute_url"],
                "company": tok,
            })
        return out

    def ashby(tok):
        d = fetch(f"https://api.ashbyhq.com/posting-api/job-board/{tok}")
        if not d or "jobs" not in d:
            return None
        return [{
            "date": (j.get("publishedAt") or j.get("updatedAt") or "")[:10],
            "title": (j.get("title") or "").strip(),
            "loc": (j.get("location") or "").strip(),
            "url": j["jobUrl"],
            "company": tok,
        } for j in d["jobs"]]

    def lever(tok):
        d = fetch(f"https://api.lever.co/v0/postings/{tok}?mode=json")
        if not isinstance(d, list):
            return None
        out = []
        for j in d:
            ts = datetime.datetime.fromtimestamp(
                j.get("createdAt", 0) / 1000, datetime.timezone.utc
            ).strftime("%Y-%m-%d")
            out.append({
                "date": ts, "title": j.get("text", "").strip(),
                "loc": (j.get("categories") or {}).get("location", ""),
                "url": j["hostedUrl"], "company": tok,
            })
        return out

    def workday(entry):
        name, host, tenant, site = entry
        seen = {}
        for q in ("intern 2027", "new grad", "product manager", "business analyst"):
            for off in (0, 20):
                body = json.dumps({"appliedFacets": {}, "limit": 20,
                                   "offset": off, "searchText": q})
                d = fetch(f"https://{host}/wday/cxs/{tenant}/{site}/jobs", body)
                if not d or "jobPostings" not in d:
                    continue
                for j in d["jobPostings"]:
                    path = j.get("externalPath", "")
                    if not path:
                        continue
                    seen[path] = {
                        "date": "", "title": (j.get("title") or "").strip(),
                        "loc": j.get("locationsText", ""),
                        "url": f"https://{host}/en-US/{site}{path}",
                        "company": name, "posted": j.get("postedOn", ""),
                    }
        return list(seen.values()) or None

    tasks = []
    for tok in sources["greenhouse"]:
        tasks.append((greenhouse, tok, tok))
    for tok in sources["ashby"]:
        tasks.append((ashby, tok, tok))
    for tok in sources["lever"]:
        tasks.append((lever, tok, tok))
    for entry in sources["workday"]:
        tasks.append((workday, entry, None))

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda t: (t[0](t[1]), t[2]), tasks))
    for res, tok in results:
        if res is None:
            continue
        ok += 1
        if tok:
            enumerated.add(tok)
        jobs.extend(res)
        for j in res:
            live |= ids_in(j["url"])
    return jobs, live, ok, enumerated


DEEP_SECTION = "<h2>Deep sweep"

# LinkedIn's logged-out job search. This is the same endpoint a signed-out
# browser gets, so no account, cookie, or credential is involved. It reaches a
# population the GitHub trackers do not index at all: rotational programs,
# leadership development programs, graduate analyst schemes, and IB summer
# analyst classes, none of which are "software engineering internships".
LI_QUERIES = [
    "Summer 2027 Internship", "2027 Analyst Program", "2027 Rotational Program",
    "2027 Leadership Development Program", "Summer 2027 Product Management",
    "2027 Business Analyst Intern", "Emerging Talent 2027", "New Grad 2027",
]
# Staffing shops and contract mills repost aggressively; they are noise here.
LI_BLOCKLIST = re.compile(
    r"staffing|recruit(ing|ment) (agency|solutions)|consultanc|technologies llc"
    r"|talent (solutions|group)|placement|robert half|insight global|teksystems"
    r"|apex systems|aerotek|randstad|kforce|collabera|intepros|diverse lynx"
    r"|mindlance|cybercoders|jobot|motion recruitment"
    # Aggregators that repost other companies' jobs under their own name.
    r"|jobright|zip ?recruiter|lensa|talentify|dice\b|joblist|hiring ?cafe",
    re.I,
)
# Agency-side roles: recruiting *for* other firms, not a job at a real employer.
LI_TITLE_BLOCK = re.compile(
    r"recruit(ment|ing)? consultant|staffing (specialist|coordinator)"
    r"|talent acquisition (intern|associate|coordinator)|headhunt",
    re.I,
)


def linkedin_guest(pages=3):
    """Public logged-out LinkedIn job cards from the last week."""
    import urllib.parse
    out = {}
    for q in LI_QUERIES:
        for start in range(0, pages * 10, 10):
            qs = urllib.parse.urlencode({
                "keywords": q, "location": "United States",
                "f_TPR": "r604800", "start": start,
            })
            url = ("https://www.linkedin.com/jobs-guest/jobs/api/"
                   "seeMoreJobPostings/search?" + qs)
            try:
                raw = subprocess.run(
                    ["curl", "-s", "-m", str(TIMEOUT), "-A", UA, url],
                    capture_output=True, text=True).stdout
            except OSError:
                continue
            for card in re.findall(r"<li>(.*?)</li>", raw, re.S):
                title = re.search(r'base-search-card__title">\s*(.*?)\s*</h3>', card, re.S)
                co = re.search(r'base-search-card__subtitle">.*?>\s*(.*?)\s*</a>', card, re.S)
                loc = re.search(r'job-search-card__location">\s*(.*?)\s*</span>', card, re.S)
                link = re.search(r'href="(https://www\.linkedin\.com/jobs/view/[^?"]+)', card)
                when = re.search(r'datetime="([\d-]+)"', card)
                if not (title and link and co):
                    continue
                clean = lambda s: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s)).strip()
                company = clean(co.group(1))
                if LI_BLOCKLIST.search(company):
                    continue
                if LI_TITLE_BLOCK.search(clean(title.group(1))):
                    continue
                out[link.group(1)] = {
                    "date": when.group(1) if when else "",
                    "title": clean(title.group(1)),
                    "loc": clean(loc.group(1)) if loc else "",
                    "url": link.group(1), "company": company, "via": "LinkedIn",
                }
    return list(out.values())


# Community trackers beyond SimplifyJobs. Markdown pipe tables, one row per job.
TRACKERS = [
    ("vanshb03/Summer2027-Internships", "dev"),
    ("sndsh404/summer-2027-internships", "main"),
    ("ApplyGuy/2027-New-Grad-Jobs", "main"),
    ("RiverStream85/quant-internships-2027", "main"),
]


def community_trackers():
    """Rows from community-maintained markdown trackers."""
    out, last_co = [], ""
    for repo, branch in TRACKERS:
        url = f"https://raw.githubusercontent.com/{repo}/{branch}/README.md"
        try:
            md = subprocess.run(["curl", "-s", "-m", str(TIMEOUT), "-A", UA, url],
                                capture_output=True, text=True).stdout
        except OSError:
            continue
        if "|" not in md:
            continue
        for line in md.splitlines():
            if not line.startswith("| ") or "---" in line:
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) < 3:
                continue
            strip_md = lambda s: re.sub(r"\[|\]|\*\*|\*", "",
                                        re.sub(r"\((https?://[^)]*)\)", "", s)).strip()
            company = strip_md(cells[0])
            if company in ("↳", "->", ""):
                company = last_co
            else:
                last_co = company
            title = strip_md(cells[1])
            loc = strip_md(cells[2]) if len(cells) > 2 else ""
            link = re.search(r"\((https?://[^)\s]+)", line)
            if not link or not company or not title:
                continue
            href = link.group(1)
            if "simplify.jobs" in href or "utm_source" in href:
                href = href.split("?")[0]
            out.append({"date": "", "title": title, "loc": loc, "url": href,
                        "company": company, "via": f"tracker: {repo.split('/')[0]}"})
    return out


def norm_key(company, title):
    """Loose identity for a posting, to catch the same job seen on two sources."""
    c = re.sub(r"[^a-z0-9]", "", (company or "").lower())[:10]
    t = re.sub(r"[^a-z0-9]", "", (title or "").lower())[:36]
    return c + "|" + t


def existing_rows(html):
    """(company, title, url, whole row) for every row in the page."""
    pat = re.compile(
        r'<tr><td class="co">([^<]+)</td><td>(.*?)</td>'
        r'<td class="loc">([^<]*)</td><td><a href="([^"]+)"[^>]*>[^<]*</a></td></tr>'
    )
    return [(m.group(1), re.sub(r"<[^>]+>", "", m.group(2)).strip(),
             m.group(4), m.group(0)) for m in pat.finditer(html)]


def route(company, title):
    for heading, co_re, title_re in ROUTES:
        if co_re and not re.search(co_re, company, re.I):
            continue
        if title_re and not re.search(title_re, title, re.I):
            continue
        if co_re or title_re:
            return heading
    return FALLBACK


def pretty(token):
    special = {"andurilindustries": "Anduril", "trueanomalyinc": "True Anomaly",
               "nerostechnologies": "Neros", "thenuclearcompany": "The Nuclear Company",
               "flyzipline": "Zipline", "ixllearning": "IXL Learning",
               "base-power": "Base Power", "shield-ai": "Shield AI",
               "dedalus-labs": "Dedalus Labs", "applied": "Applied Intuition",
               "planetlabs": "Planet Labs", "togetherai": "Together AI",
               "physicalintelligence": "Physical Intelligence", "epicgames": "Epic Games",
               "rocketlab": "Rocket Lab", "kairospower": "Kairos Power",
               "normalcomputing": "Normal Computing", "flatironhealth": "Flatiron Health",
               "scaleai": "Scale AI", "openai": "OpenAI", "spacex": "SpaceX",
               "nvidia": "NVIDIA", "imc": "IMC Trading", "mongodb": "MongoDB",
               "gitlab": "GitLab", "paypal": "PayPal", "paloalto": "Palo Alto Networks"}
    if token in special:
        return special[token]
    return token.replace("-", " ").replace("_", " ").title()


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-new", type=int, default=40,
                    help="cap curated-section rows added in one run")
    ap.add_argument("--max-deep", type=int, default=60,
                    help="cap wide-net rows added in one run")
    ap.add_argument("--deep-keep", type=int, default=150,
                    help="max rows kept in the wide-net section; oldest are trimmed")
    ap.add_argument("--no-deep", action="store_true",
                    help="skip LinkedIn and community trackers, boards only")
    args = ap.parse_args()

    today = datetime.date.today()
    sources = json.load(open(SOURCES))
    html = open(INDEX).read()

    jobs, live_ids, boards_ok, enumerated = sweep(sources)
    total_boards = sum(len(v) for v in sources.values())
    print(f"swept {boards_ok}/{total_boards} boards, {len(jobs)} postings")

    if boards_ok < total_boards * 0.6:
        print("too many boards failed, refusing to edit the page", file=sys.stderr)
        return 1

    rows = existing_rows(html)
    # Dedupe against ids anywhere in the page, not just parsed rows, so a row
    # with unusual markup can never cause a duplicate to be appended.
    known_ids = ids_in(html)

    # --- 1. mark rows whose posting is gone from a board we did reach -------
    closed = []
    for co, title, url, row in rows:
        if 'tag cl"' in row:
            continue
        tok = board_token(url)
        if not tok or tok not in enumerated:
            continue  # board not enumerated this run, absence proves nothing
        rid = ids_in(url)
        if not rid or (rid & live_ids):
            continue
        tagged = row.replace(
            "</td><td class=\"loc\">",
            f' <span class="tag cl">closed {today:%-d %b}</span></td><td class="loc">', 1
        )
        html = html.replace(row, tagged, 1)
        closed.append(f"{co} — {title}")

    # --- 2. append genuinely new early-career postings ----------------------
    cutoff = (today - datetime.timedelta(days=4)).isoformat()
    fresh = []
    for j in jobs:
        if not j["date"] or j["date"] < cutoff:
            continue
        t, loc = j["title"], j["loc"]
        if not EARLY.search(t) or SENIOR.search(t) or JUNK.search(t):
            continue
        if loc and not US.search(loc):
            continue
        if ids_in(j["url"]) & known_ids:
            continue
        known_ids |= ids_in(j["url"])
        fresh.append(j)

    fresh.sort(key=lambda j: (j["date"], j["company"]), reverse=True)
    if len(fresh) > args.max_new:
        print(f"capping {len(fresh)} new rows at {args.max_new}")
        fresh = fresh[:args.max_new]

    # --- 2b. wide net: LinkedIn logged-out search and community trackers ----
    # These land in their own section. They are unvetted by design, so they must
    # never dilute the hand-curated sections above.
    deep = []
    if not args.no_deep and DEEP_SECTION in html:
        known_keys = {norm_key(co, ti) for co, ti, _, _ in rows}
        wide = linkedin_guest() + community_trackers()
        print(f"wide net: {len(wide)} postings from LinkedIn and community trackers")
        for j in wide:
            t = j["title"]
            if not EARLY.search(t) or SENIOR.search(t) or JUNK.search(t):
                continue
            if j["loc"] and not US.search(j["loc"]):
                continue
            if ids_in(j["url"]) & known_ids:
                continue
            key = norm_key(j["company"], t)
            if key in known_keys:
                continue
            known_keys.add(key)
            known_ids |= ids_in(j["url"])
            deep.append(j)
        deep.sort(key=lambda j: j["date"], reverse=True)
        if len(deep) > args.max_deep:
            print(f"capping {len(deep)} wide-net rows at {args.max_deep}")
            deep = deep[:args.max_deep]

    added = []
    by_section = {}
    for j in fresh:
        co = pretty(j["company"])
        by_section.setdefault(route(co, j["title"]), []).append((co, j))
    for j in deep:
        by_section.setdefault(DEEP_SECTION, []).append((j["company"], j))

    for heading, items in by_section.items():
        if heading not in html:
            continue
        insert = html.index("</table></div>", html.index(heading))
        block = ""
        for co, j in items:
            tags = ""
            if j.get("date"):
                stamp_tag = datetime.date.fromisoformat(j["date"]).strftime("%-d %b")
                tags += f' <span class="tag new">{stamp_tag}</span>'
            if j.get("via"):
                tags += f' <span class="tag">via {esc(j["via"])}</span>'
            loc = esc(j["loc"][:60]) or "See posting"
            block += (f'<tr><td class="co">{esc(co)}</td>'
                      f'<td>{esc(j["title"])}{tags}</td>'
                      f'<td class="loc">{loc}</td>'
                      f'<td><a href="{j["url"]}">Apply</a></td></tr>\n')
            added.append(f"{co} — {j['title']} ({j['loc'][:40]})")
        html = html[:insert] + block + html[insert:]

    # --- 2c. keep the wide net from growing without bound -------------------
    # LinkedIn returns a rotating slice, so without a cap this section would
    # gain rows every single day forever. These are auto-generated and unvetted,
    # so trimming the oldest is safe. Curated sections are never trimmed.
    pruned = 0
    if DEEP_SECTION in html:
        start = html.index(DEEP_SECTION)
        end = html.index("</table></div>", start)
        body = html[start:end]
        deep_rows = re.findall(r'<tr><td class="co">.*?</tr>\n?', body)
        if len(deep_rows) > args.deep_keep:
            drop = deep_rows[:len(deep_rows) - args.deep_keep]
            new_body = body
            for row in drop:
                new_body = new_body.replace(row, "", 1)
            html = html[:start] + new_body + html[end:]
            pruned = len(drop)
            print(f"pruned {pruned} oldest wide-net rows, keeping {args.deep_keep}")

    # --- 3. rewrite the refreshed-on line -----------------------------------
    count = html.count('<tr><td class="co">')
    stamp = f"{today:%-d %b %Y}"
    html = re.sub(
        r'<span id="refreshed">.*?</span>',
        f'<span id="refreshed">{stamp}, {count} roles</span>',
        html, count=1,
    )

    if not added and not closed and not pruned:
        print("no change")
        return 0

    print(f"+{len(added)} new, {len(closed)} closed, {count} rows total")
    for line in added:
        print("  + " + line)
    for line in closed:
        print("  x " + line)

    if args.dry_run:
        return 0

    open(INDEX, "w").write(html)
    entry = [f"## {today:%Y-%m-%d}", ""]
    if added:
        entry += [f"Added {len(added)}:", ""] + [f"- {a}" for a in added] + [""]
    if closed:
        entry += [f"Closed {len(closed)}:", ""] + [f"- {c}" for c in closed] + [""]
    if pruned:
        entry += [f"Trimmed {pruned} stale wide-net rows.", ""]
    old = open(CHANGELOG).read() if os.path.exists(CHANGELOG) else "# Changelog\n"
    head, _, rest = old.partition("\n")
    open(CHANGELOG, "w").write(head + "\n\n" + "\n".join(entry) + rest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
