#!/usr/bin/env python3
"""Localhost server for the auto-apply setup UI.

Serves the static UI in apply/ui/ and a JSON API over the user's private
data in apply/user/ (profile, resume library, queue, application log).
Stdlib only. Binds 127.0.0.1 only. Every write lands inside the user
dir, goes through one atomic-write helper, and keeps a one-deep backup.

Run: python3 apply/serve.py [--port 8787]

The user dir defaults to apply/user/ and can be moved with the
APPLY_USER_DIR env var. Tests point it at tmp dirs.
"""

import argparse
import copy
import datetime
import email.parser
import errno
import json
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit

HERE = os.path.dirname(os.path.abspath(__file__))
UI_DIR = os.path.join(HERE, "ui")
TEMPLATE_DIR = os.path.join(HERE, "templates")
MAX_UPLOAD = 10 * 1024 * 1024

PROFILE_FIELDS = (
    "name", "email", "phone", "location", "school", "degree", "major",
    "grade_level", "gpa", "grad_date", "linkedin", "github", "portfolio",
    # Sponsorship is two answers because forms phrase it two ways:
    # current-role scope and now-or-in-the-future scope. They differ
    # for e.g. F-1 CPT students. requires_sponsorship stays for old
    # profile.json files.
    "work_authorization", "requires_sponsorship",
    "requires_sponsorship_now", "requires_sponsorship_future",
    # High-frequency screener facts. Stored once, typed per ATS.
    "willing_to_relocate", "willing_onsite", "willing_travel_pct",
    "start_availability", "desired_compensation", "drivers_license",
    # EEO fields hold one canonical value ("decline" allowed). The
    # fieldmaps translate it to each ATS's own decline wording.
    "veteran_status", "disability_status", "gender", "race_ethnicity",
)
# Greenhouse usually wants one single-line location. Lever and Ashby
# often want structured street/city/state/zip. Carry both forms. The
# template nests the parts under "structured". Flat parts are accepted
# too so hand-written profiles keep working.
STREET_FIELDS = ("street", "city", "state", "zip")
ADDRESS_FIELDS = ("single_line", "structured") + STREET_FIELDS
DEFAULT_PROFILE = {field: "" for field in PROFILE_FIELDS}
DEFAULT_PROFILE["address"] = {
    "single_line": "",
    "structured": {field: "" for field in STREET_FIELDS},
}
DEFAULT_PROFILE["custom"] = {}

# Legal status moves. Terminal statuses map to an empty set and change
# only via {"reopen": true}, which returns the item to "queued".
LEGAL_MOVES = {
    "queued": {"parked", "blocked", "unsupported", "skipped"},
    "parked": {"submitted", "skipped"},
    "submitted": set(),
    "skipped": set(),
    "blocked": set(),
    "unsupported": set(),
}
TERMINAL = {status for status, moves in LEGAL_MOVES.items() if not moves}

ALLOWED_QUEUE_FIELDS = {
    "status", "reopen", "notes", "resume_id", "attempts", "last_attempt",
}
NOTE_FIELDS = {"resume_id", "fields_pending", "screeners_unanswered", "free_text"}

TRACKING_PARAMS = {"gh_src", "lever-source", "ref", "source"}
UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


class ApiError(Exception):
    """An error the handler turns into a JSON 4xx/5xx response."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# User-dir storage. All paths resolve under user_dir(), verified by realpath.

def user_dir():
    return os.path.abspath(os.environ.get("APPLY_USER_DIR") or os.path.join(HERE, "user"))


def inside_user_dir(path):
    base = os.path.realpath(user_dir())
    real = os.path.realpath(path)
    return real == base or real.startswith(base + os.sep)


def user_path(*parts):
    """Join parts under the user dir. Reject anything that escapes it."""
    path = os.path.join(user_dir(), *parts)
    if not inside_user_dir(path):
        raise ApiError(400, "path escapes the user dir")
    return path


def write_user_json(name, data):
    """Atomically write one of the user JSON files, keeping a .bak.

    Serializes to a temp file, fsyncs it, copies the current file to
    <name>.json.bak when one exists, then os.replace onto the target.
    A failure mid-serialization leaves the target and .bak untouched.
    """
    if os.path.basename(name) != name or name.startswith("."):
        raise ApiError(400, f"bad file name: {name}")
    os.makedirs(user_dir(), exist_ok=True)
    target = user_path(name)
    tmp = target + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    if os.path.exists(target):
        shutil.copy2(target, target + ".bak")
    os.replace(tmp, target)


def load_user_json(name, template_name, default):
    upath = os.path.join(user_dir(), name)
    if os.path.isfile(upath):
        with open(upath, encoding="utf-8") as fh:
            return json.load(fh)
    if template_name:
        tpath = os.path.join(TEMPLATE_DIR, template_name)
        if os.path.isfile(tpath):
            with open(tpath, encoding="utf-8") as fh:
                return json.load(fh)
    return copy.deepcopy(default)


def load_profile():
    return load_user_json("profile.json", "profile.template.json", DEFAULT_PROFILE)


def load_library():
    lib = load_user_json("library.json", "library.template.json", {"resumes": []})
    if not isinstance(lib, dict) or not isinstance(lib.get("resumes"), list):
        lib = {"resumes": []}
    return lib


def load_queue():
    queue = load_user_json("queue.json", None, {"items": []})
    if not isinstance(queue, dict) or not isinstance(queue.get("items"), list):
        queue = {"items": []}
    return queue


def load_log():
    path = os.path.join(user_dir(), "log.jsonl")
    if not os.path.isfile(path):
        return []
    entries = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                # A corrupt line must not hide the rest of the history.
                continue
    return entries


# ---------------------------------------------------------------------------
# Profile

def _validate_address(value):
    if not isinstance(value, dict):
        raise ApiError(400, "address must be an object")
    unknown = set(value) - set(ADDRESS_FIELDS)
    if unknown:
        raise ApiError(400, f"unknown address fields: {', '.join(sorted(unknown))}")
    for ak, av in value.items():
        if ak == "structured":
            if not isinstance(av, dict):
                raise ApiError(400, "address.structured must be an object")
            bad = set(av) - set(STREET_FIELDS)
            if bad:
                raise ApiError(
                    400,
                    f"unknown address.structured fields: {', '.join(sorted(bad))}",
                )
            for sk, sv in av.items():
                if not isinstance(sv, str):
                    raise ApiError(400, f"address.structured.{sk} must be a string")
        elif not isinstance(av, str):
            raise ApiError(400, f"address.{ak} must be a string")


def save_profile(body):
    if not isinstance(body, dict):
        raise ApiError(400, "profile must be a JSON object")
    for key, value in body.items():
        if key == "custom":
            if not isinstance(value, dict):
                raise ApiError(400, "custom must be an object")
            for ck, cv in value.items():
                if not isinstance(ck, str) or not isinstance(cv, str):
                    raise ApiError(400, "custom entries must be strings")
        elif key == "address":
            _validate_address(value)
        elif key in PROFILE_FIELDS:
            if value is not None and not isinstance(value, (str, bool)):
                raise ApiError(400, f"field must be a string: {key}")
        else:
            raise ApiError(400, f"unknown profile field: {key}")
    write_user_json("profile.json", body)
    return body


# ---------------------------------------------------------------------------
# URL canonicalization, ATS detection, dedupe keys

def canonical_url(url):
    """Lowercase scheme and host, drop fragment, trailing slash, tracking."""
    parts = urlsplit(url.strip())
    kept = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not k.lower().startswith("utm_") and k.lower() not in TRACKING_PARAMS
    ]
    return urlunsplit((
        parts.scheme.lower(),
        parts.netloc.lower(),
        parts.path.rstrip("/"),
        urlencode(sorted(kept)),
        "",
    ))


def _greenhouse_key(host, segs, params):
    if host.endswith("greenhouse.io") and len(segs) >= 3 \
            and segs[-2] == "jobs" and segs[-1].isdigit():
        return f"greenhouse:{segs[0].lower()}:{segs[-1]}"
    jid = params.get("token") or params.get("gh_jid")
    if not jid or not jid.isdigit():
        return None
    slug = params.get("for")
    if not slug and host.endswith("greenhouse.io") and segs:
        slug = segs[0]
    if not slug:
        labels = host.split(":")[0].split(".")
        slug = labels[-2] if len(labels) >= 2 else labels[0]
    return f"greenhouse:{slug.lower()}:{jid}"


def detect_ats(canon):
    """Return (ats, job_key) for a canonical URL. Key is None if unknown."""
    parts = urlsplit(canon)
    host = parts.netloc.split(":")[0]
    segs = [s for s in parts.path.split("/") if s]
    params = dict(parse_qsl(parts.query))
    if host.endswith("greenhouse.io") or "gh_jid" in params:
        return "greenhouse", _greenhouse_key(host, segs, params)
    if host.endswith("lever.co"):
        match = UUID_RE.search(parts.path)
        return "lever", f"lever:{match.group(0).lower()}" if match else None
    if host.endswith("ashbyhq.com"):
        keep = [s for s in segs if s.lower() != "application"]
        if len(keep) >= 2:
            return "ashby", f"ashby:{keep[0].lower()}:{keep[1].lower()}"
        return "ashby", None
    return "other", None


def dedupe_key(url):
    """The identity used for dedupe: job key, or canonical URL fallback."""
    if not isinstance(url, str) or not url.strip():
        return None
    canon = canonical_url(url)
    _, key = detect_ats(canon)
    return key or canon


# ---------------------------------------------------------------------------
# Queue

def known_apply_keys(queue):
    """Map dedupe key to rejection reason for everything already known."""
    keys = {}
    for entry in load_log():
        if not isinstance(entry, dict):
            continue
        # Register both the recorded key and the url-derived key, so a
        # log line whose key format drifted still blocks a re-add.
        for key in (entry.get("key"), dedupe_key(entry.get("url"))):
            if key:
                keys[key] = "already-applied"
    for item in queue.get("items", []):
        key = item.get("key") or dedupe_key(item.get("url"))
        if key:
            keys[key] = "duplicate"
    return keys


def add_queue_urls(body):
    if not isinstance(body, dict) or not isinstance(body.get("urls"), list):
        raise ApiError(400, 'body must be {"urls": [...]}')
    queue = load_queue()
    seen = known_apply_keys(queue)
    added, rejected = [], []
    for url in body["urls"]:
        if not isinstance(url, str) or not url.strip():
            raise ApiError(400, "urls must be non-empty strings")
        url = url.strip()
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise ApiError(400, f"invalid url: {url}")
        canon = canonical_url(url)
        ats, job_key = detect_ats(canon)
        key = job_key or canon
        if key in seen:
            rejected.append({"url": url, "reason": seen[key]})
            continue
        seen[key] = "duplicate"
        item = {
            "id": secrets.token_hex(8),
            "url": url,
            "ats": ats,
            "status": "unsupported" if ats == "other" else "queued",
            "added": now_iso(),
            "key": key,
        }
        queue["items"].append(item)
        added.append(item)
    if added:
        write_user_json("queue.json", queue)
    return {"added": added, "rejected": rejected}


def _apply_status_change(item, body):
    current = item.get("status", "queued")
    if "reopen" in body and not isinstance(body["reopen"], bool):
        raise ApiError(400, "reopen must be a boolean")
    if body.get("reopen") is True:
        if "status" in body:
            raise ApiError(400, "reopen cannot combine with status")
        if current not in TERMINAL:
            raise ApiError(400, f"cannot reopen: {current} is not terminal")
        item["status"] = "queued"
        return
    if "status" not in body:
        return
    new = body["status"]
    if not isinstance(new, str) or new not in LEGAL_MOVES:
        raise ApiError(400, f"unknown status: {new}")
    # A hand-edited queue file can hold a status this build does not
    # know. Treat it as having no legal moves instead of crashing.
    if new not in LEGAL_MOVES.get(current, set()):
        raise ApiError(400, f"illegal transition: {current} -> {new}")
    item["status"] = new


def _validate_notes(notes):
    if not isinstance(notes, dict):
        raise ApiError(400, "notes must be an object")
    unknown = set(notes) - NOTE_FIELDS
    if unknown:
        raise ApiError(400, f"unknown notes fields: {', '.join(sorted(unknown))}")
    for key in ("resume_id", "free_text"):
        if key in notes and not isinstance(notes[key], str):
            raise ApiError(400, f"notes.{key} must be a string")
    for key in ("fields_pending", "screeners_unanswered"):
        if key in notes:
            value = notes[key]
            if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
                raise ApiError(400, f"notes.{key} must be a list of strings")
    return notes


def _apply_queue_fields(item, body):
    if "resume_id" in body:
        rid = body["resume_id"]
        known = {r.get("id") for r in load_library()["resumes"]}
        if not isinstance(rid, str) or rid not in known:
            raise ApiError(400, f"resume_id not in library: {rid}")
        item["resume_id"] = rid
    if "attempts" in body:
        attempts = body["attempts"]
        if isinstance(attempts, bool) or not isinstance(attempts, int) or attempts < 0:
            raise ApiError(400, "attempts must be a non-negative integer")
        item["attempts"] = attempts
    if "last_attempt" in body:
        stamp = body["last_attempt"]
        if not isinstance(stamp, str) or not _is_iso(stamp):
            raise ApiError(400, f"last_attempt must be an ISO timestamp: {stamp!r}")
        item["last_attempt"] = stamp
    if "notes" in body:
        item["notes"] = _validate_notes(body["notes"])


def _is_iso(stamp):
    try:
        datetime.datetime.fromisoformat(stamp)
    except ValueError:
        return False
    return True


def update_queue_item(item_id, body):
    if not isinstance(body, dict):
        raise ApiError(400, "body must be a JSON object")
    unknown = set(body) - ALLOWED_QUEUE_FIELDS
    if unknown:
        raise ApiError(400, f"unknown fields: {', '.join(sorted(unknown))}")
    queue = load_queue()
    item = next((i for i in queue["items"] if i.get("id") == item_id), None)
    if item is None:
        raise ApiError(404, f"no queue item: {item_id}")
    _apply_status_change(item, body)
    _apply_queue_fields(item, body)
    write_user_json("queue.json", queue)
    return item


def delete_queue_item(item_id):
    queue = load_queue()
    kept = [i for i in queue["items"] if i.get("id") != item_id]
    if len(kept) == len(queue["items"]):
        raise ApiError(404, f"no queue item: {item_id}")
    queue["items"] = kept
    write_user_json("queue.json", queue)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Resume library

def parse_multipart(body, ctype):
    head = f"Content-Type: {ctype}\r\nMIME-Version: 1.0\r\n\r\n"
    msg = email.parser.BytesParser().parsebytes(head.encode("ascii", "replace") + body)
    if not msg.is_multipart():
        raise ApiError(400, "malformed multipart body")
    parts = {}
    for part in msg.get_payload():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        parts[name] = {
            "filename": part.get_filename(),
            "value": part.get_payload(decode=True) or b"",
        }
    return parts


def add_resume(data, original_name, label, tags):
    """Save the PDF under a server-chosen name and append a library entry."""
    rid = secrets.token_hex(8)
    files_dir = user_path("files")
    os.makedirs(files_dir, exist_ok=True)
    dest = user_path("files", rid + ".pdf")
    with open(dest, "wb") as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    entry = {
        "id": rid,
        "label": label,
        "file": f"files/{rid}.pdf",
        "tags": tags,
        "added": now_iso(),
        "original_name": original_name,
    }
    library = load_library()
    library["resumes"].append(entry)
    write_user_json("library.json", library)
    return entry


def _parse_tags(raw):
    if isinstance(raw, list):
        if not all(isinstance(t, str) for t in raw):
            raise ApiError(400, "tags must be strings")
        return [t.strip() for t in raw if t.strip()]
    if isinstance(raw, str):
        return [t.strip() for t in raw.split(",") if t.strip()]
    raise ApiError(400, "tags must be a list or a comma string")


def update_resume(rid, body):
    if not isinstance(body, dict):
        raise ApiError(400, "body must be a JSON object")
    unknown = set(body) - {"label", "tags"}
    if unknown:
        raise ApiError(400, f"unknown fields: {', '.join(sorted(unknown))}")
    library = load_library()
    entry = next((r for r in library["resumes"] if r.get("id") == rid), None)
    if entry is None:
        raise ApiError(404, f"no resume: {rid}")
    if "label" in body:
        if not isinstance(body["label"], str) or not body["label"].strip():
            raise ApiError(400, "label must be a non-empty string")
        entry["label"] = body["label"].strip()
    if "tags" in body:
        entry["tags"] = _parse_tags(body["tags"])
    write_user_json("library.json", library)
    return entry


def delete_resume(rid):
    library = load_library()
    entry = next((r for r in library["resumes"] if r.get("id") == rid), None)
    if entry is None:
        raise ApiError(404, f"no resume: {rid}")
    library["resumes"] = [r for r in library["resumes"] if r.get("id") != rid]
    file_rel = entry.get("file")
    if file_rel:
        path = user_path(*file_rel.split("/"))
        if os.path.isfile(path):
            os.remove(path)
    write_user_json("library.json", library)
    return {"ok": True}


# ---------------------------------------------------------------------------
# HTTP handler

class Handler(BaseHTTPRequestHandler):
    server_version = "apply-serve/1.0"

    def log_message(self, fmt, *args):
        pass

    def _send(self, status, obj=None, body=None, ctype="application/json"):
        data = body if body is not None else json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ApiError(400, "invalid JSON body") from exc

    def _static(self, path):
        rel = "index.html" if path in ("/", "/ui", "/ui/") else path[len("/ui/"):]
        base = os.path.realpath(UI_DIR)
        real = os.path.realpath(os.path.join(UI_DIR, rel))
        if real != base and not real.startswith(base + os.sep):
            raise ApiError(404, "not found")
        if not os.path.isfile(real):
            raise ApiError(404, "not found")
        ctype = mimetypes.guess_type(real)[0] or "application/octet-stream"
        with open(real, "rb") as fh:
            self._send(200, body=fh.read(), ctype=ctype)

    def _upload_resume(self):
        length = self.headers.get("Content-Length")
        if length is None:
            raise ApiError(411, "missing Content-Length")
        if int(length) > MAX_UPLOAD:
            self.close_connection = True
            raise ApiError(413, "upload too large, 10 MB cap")
        ctype = self.headers.get("Content-Type") or ""
        if not ctype.startswith("multipart/form-data"):
            raise ApiError(400, "expected multipart/form-data")
        parts = parse_multipart(self.rfile.read(int(length)), ctype)
        file_part = parts.get("file")
        if file_part is None or not file_part["filename"]:
            raise ApiError(400, "missing file part")
        data = file_part["value"]
        if not data.startswith(b"%PDF-"):
            raise ApiError(400, "not a PDF")
        original = file_part["filename"]
        label = (parts.get("label", {}).get("value") or b"").decode("utf-8").strip()
        if not label:
            label = os.path.basename(original) or "resume"
        tags_raw = (parts.get("tags", {}).get("value") or b"").decode("utf-8")
        tags = [t.strip() for t in tags_raw.split(",") if t.strip()]
        return add_resume(data, original, label, tags)

    def _handle_get(self, path):
        if path == "/api/profile":
            return self._send(200, load_profile())
        if path == "/api/library":
            return self._send(200, load_library())
        if path == "/api/queue":
            return self._send(200, load_queue())
        if path == "/api/log":
            return self._send(200, load_log())
        if path in ("/", "/ui", "/ui/") or path.startswith("/ui/"):
            return self._static(path)
        raise ApiError(404, "not found")

    def _handle_post(self, path):
        if path == "/api/resumes":
            return self._send(200, self._upload_resume())
        if path == "/api/queue":
            return self._send(200, add_queue_urls(self._read_json()))
        raise ApiError(404, "not found")

    def _handle_put(self, path):
        if path == "/api/profile":
            return self._send(200, save_profile(self._read_json()))
        match = re.fullmatch(r"/api/resumes/([^/]+)", path)
        if match:
            return self._send(200, update_resume(match.group(1), self._read_json()))
        match = re.fullmatch(r"/api/queue/([^/]+)", path)
        if match:
            return self._send(200, update_queue_item(match.group(1), self._read_json()))
        raise ApiError(404, "not found")

    def _handle_delete(self, path):
        match = re.fullmatch(r"/api/resumes/([^/]+)", path)
        if match:
            return self._send(200, delete_resume(match.group(1)))
        match = re.fullmatch(r"/api/queue/([^/]+)", path)
        if match:
            return self._send(200, delete_queue_item(match.group(1)))
        raise ApiError(404, "not found")

    def _route(self, method):
        path = unquote(urlsplit(self.path).path)
        handlers = {
            "GET": self._handle_get,
            "POST": self._handle_post,
            "PUT": self._handle_put,
            "DELETE": self._handle_delete,
        }
        try:
            handlers[method](path)
        except ApiError as exc:
            self._send(exc.status, {"error": exc.message})
        except Exception as exc:  # surface the failure, never swallow it
            self._send(500, {"error": f"{type(exc).__name__}: {exc}"})

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PUT(self):
        self._route("PUT")

    def do_DELETE(self):
        self._route("DELETE")


# ---------------------------------------------------------------------------
# Startup

def leak_check():
    """Refuse to start if the user dir could leak into git.

    Skips quietly when git is missing or the user dir is outside a repo.
    """
    base = user_dir()
    probe = os.path.join(base, "profile.json")
    parent = os.path.dirname(base)
    try:
        ignored = subprocess.run(
            ["git", "-C", parent, "check-ignore", "-q", probe],
            capture_output=True,
        )
    except FileNotFoundError:
        return
    if ignored.returncode == 128:
        return
    if ignored.returncode != 0:
        print(f"{base} is not gitignored.", file=sys.stderr)
        print('Fix: add "apply/user/" to .gitignore, then rerun.', file=sys.stderr)
        sys.exit(1)
    tracked = subprocess.run(
        ["git", "-C", parent, "ls-files", "--", base],
        capture_output=True, text=True,
    )
    if tracked.returncode == 0 and tracked.stdout.strip():
        print("git is tracking files under the user dir:", file=sys.stderr)
        print(tracked.stdout.strip(), file=sys.stderr)
        print("Fix: git rm --cached <file> for each, then rerun.", file=sys.stderr)
        sys.exit(1)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Auto-apply setup server")
    parser.add_argument("--port", type=int, default=8787, help="port on 127.0.0.1")
    args = parser.parse_args(argv)
    leak_check()
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            print(
                f"port {args.port} in use, is serve.py already running, "
                f"retry with --port N",
                file=sys.stderr,
            )
            sys.exit(1)
        raise
    print(f"serving on http://127.0.0.1:{args.port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()


if __name__ == "__main__":
    main()
