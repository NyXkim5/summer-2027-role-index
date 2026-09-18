"""Tests for apply/serve.py. Run: python3 -m pytest apply/test_serve.py -q

Every test points APPLY_USER_DIR at a tmp dir. Nothing here touches the
real apply/user/ directory.
"""

import http.client
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import urllib.error
import urllib.request

import pytest

import serve

SERVE_PY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "serve.py")

GH_BOARD = "https://boards.greenhouse.io/acme/jobs/4001234"
GH_JOB_BOARDS = "https://job-boards.greenhouse.io/acme/jobs/4001234"
GH_REFERRAL = "https://Boards.Greenhouse.io/acme/jobs/4001234/?gh_src=abc12&utm_source=linkedin"
GH_EMBED = "https://www.acme.com/careers/apply?gh_jid=4001234&utm_campaign=x"
LEVER_UUID = "8a7b6c5d-1234-4abc-9def-0123456789ab"
LEVER_URL = f"https://jobs.lever.co/acme/{LEVER_UUID}"
ASHBY_URL = "https://jobs.ashbyhq.com/Acme/swe-intern-2027/application"
OTHER_URL = "https://careers.example.com/jobs/123"


# ---------------------------------------------------------------------------
# Fixtures and helpers

@pytest.fixture
def env(tmp_path, monkeypatch):
    udir = tmp_path / "user"
    monkeypatch.setenv("APPLY_USER_DIR", str(udir))
    # Keep tests hermetic. The real templates dir must never leak in.
    monkeypatch.setattr(serve, "TEMPLATE_DIR", str(tmp_path / "no-templates"))
    return udir


@pytest.fixture
def server(env):
    httpd = serve.ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def call(base, method, path, body=None, data=None, headers=None):
    hdrs = dict(headers or {})
    payload = data
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(base + path, data=payload, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        return exc.code, json.loads(raw) if raw else {}


def multipart(filename, filedata, label=None, tags=None):
    boundary = "b0undary42"
    chunks = []
    for name, value in (("label", label), ("tags", tags)):
        if value is None:
            continue
        chunks.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"'
            f"\r\n\r\n{value}\r\n".encode("utf-8")
        )
    chunks.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
        f'filename="{filename}"\r\nContent-Type: application/pdf\r\n\r\n'.encode("utf-8")
        + filedata + b"\r\n"
    )
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(chunks)
    return body, {"Content-Type": f"multipart/form-data; boundary={boundary}"}


def upload(base, filename=" JNK.pdf", filedata=b"%PDF-1.4 fake", label="SWE", tags="swe,backend"):
    body, headers = multipart(filename, filedata, label=label, tags=tags)
    return call(base, "POST", "/api/resumes", data=body, headers=headers)


def queue_one(base, url):
    status, resp = call(base, "POST", "/api/queue", body={"urls": [url]})
    assert status == 200, resp
    assert len(resp["added"]) == 1, resp
    return resp["added"][0]


# ---------------------------------------------------------------------------
# Atomic writes

def test_atomic_write_creates_backup(env):
    serve.write_user_json("profile.json", {"v": 1})
    serve.write_user_json("profile.json", {"v": 2})
    with open(env / "profile.json") as fh:
        assert json.load(fh) == {"v": 2}
    with open(env / "profile.json.bak") as fh:
        assert json.load(fh) == {"v": 1}


def test_atomic_write_failure_leaves_target_and_bak(env):
    serve.write_user_json("queue.json", {"v": 1})
    serve.write_user_json("queue.json", {"v": 2})
    with pytest.raises(TypeError):
        serve.write_user_json("queue.json", {"a": 1, "bad": object()})
    with open(env / "queue.json") as fh:
        assert json.load(fh) == {"v": 2}
    with open(env / "queue.json.bak") as fh:
        assert json.load(fh) == {"v": 1}
    assert not (env / "queue.json.tmp").exists()


def test_atomic_write_rejects_traversal_name(env):
    with pytest.raises(serve.ApiError):
        serve.write_user_json("../evil.json", {})


# ---------------------------------------------------------------------------
# Profile

def test_profile_falls_back_to_template(server, tmp_path, monkeypatch):
    tdir = tmp_path / "templates"
    tdir.mkdir()
    (tdir / "profile.template.json").write_text(json.dumps({"name": "Template"}))
    monkeypatch.setattr(serve, "TEMPLATE_DIR", str(tdir))
    status, resp = call(server, "GET", "/api/profile")
    assert status == 200
    assert resp == {"name": "Template"}


def test_profile_fallback_serves_shipped_template(server, monkeypatch):
    # Point TEMPLATE_DIR back at the real templates dir. A fresh clone
    # with no profile.json must see the new screener keys over the API.
    monkeypatch.setattr(
        serve, "TEMPLATE_DIR", os.path.join(os.path.dirname(SERVE_PY), "templates")
    )
    status, resp = call(server, "GET", "/api/profile")
    assert status == 200
    for key in NEW_PROFILE_KEYS:
        assert key in resp, key
    assert "address" in resp


def test_profile_falls_back_to_default_without_template(server, tmp_path, monkeypatch):
    monkeypatch.setattr(serve, "TEMPLATE_DIR", str(tmp_path / "no-templates"))
    status, resp = call(server, "GET", "/api/profile")
    assert status == 200
    assert resp["name"] == ""
    assert resp["custom"] == {}
    assert "work_authorization" in resp


def test_profile_put_then_get(server, env):
    profile = {"name": "Jay", "email": "j@example.com", "custom": {"clearance": "none"}}
    status, resp = call(server, "PUT", "/api/profile", body=profile)
    assert status == 200
    assert resp == profile
    status, resp = call(server, "GET", "/api/profile")
    assert status == 200
    assert resp == profile
    assert (env / "profile.json").exists()


NEW_PROFILE_KEYS = (
    "requires_sponsorship_now", "requires_sponsorship_future",
    "willing_to_relocate", "willing_onsite", "willing_travel_pct",
    "start_availability", "desired_compensation", "drivers_license",
)
STREET_KEYS = ("street", "city", "state", "zip")


def test_profile_accepts_screener_fields_round_trip(server):
    profile = {
        "name": "Jay",
        "requires_sponsorship_now": "No",
        "requires_sponsorship_future": "Yes",
        "willing_to_relocate": "Yes",
        "willing_onsite": "Yes",
        "willing_travel_pct": "25",
        "start_availability": "June 2027",
        "desired_compensation": "market rate",
        "drivers_license": "Yes",
        "veteran_status": "decline",
        "address": {
            "single_line": "1 Main St, Boston, MA 02110",
            "structured": {
                "street": "1 Main St",
                "city": "Boston",
                "state": "MA",
                "zip": "02110",
            },
        },
    }
    status, resp = call(server, "PUT", "/api/profile", body=profile)
    assert status == 200
    assert resp == profile
    status, resp = call(server, "GET", "/api/profile")
    assert status == 200
    assert resp == profile


def test_profile_accepts_flat_address(server):
    # Hand-written profiles may skip the "structured" nesting.
    profile = {"address": {"single_line": "Boston, MA", "city": "Boston", "state": "MA"}}
    status, resp = call(server, "PUT", "/api/profile", body=profile)
    assert status == 200
    assert resp == profile


def test_profile_rejects_bad_address(server):
    for bad in (
        "1 Main St",
        {"country": "US"},
        {"city": 7},
        {"structured": "1 Main St"},
        {"structured": {"country": "US"}},
        {"structured": {"zip": 2110}},
    ):
        status, resp = call(server, "PUT", "/api/profile", body={"address": bad})
        assert status == 400, f"address={bad!r} accepted"
        assert "address" in resp["error"]


def test_profile_default_contains_screener_fields(server):
    # No user profile and no template: the built-in default must still
    # carry every field the fieldmaps read.
    status, resp = call(server, "GET", "/api/profile")
    assert status == 200
    for key in NEW_PROFILE_KEYS:
        assert resp[key] == "", key
    assert resp["requires_sponsorship"] == ""
    assert resp["address"] == {
        "single_line": "",
        "structured": {k: "" for k in STREET_KEYS},
    }


def test_profile_template_contains_screener_fields():
    # The shipped template is the fallback GET /api/profile serves. It
    # must carry the new keys so a fresh clone sees them in the UI.
    path = os.path.join(os.path.dirname(SERVE_PY), "templates", "profile.template.json")
    with open(path, encoding="utf-8") as fh:
        template = json.load(fh)
    for key in NEW_PROFILE_KEYS:
        assert key in template, key
    assert isinstance(template.get("address"), dict)
    assert "single_line" in template["address"]
    for key in STREET_KEYS:
        assert key in template["address"]["structured"], key
    # Every non-comment template field must pass PUT validation, so a
    # user who saves the template as-is never gets a 400.
    body = {k: v for k, v in template.items() if not k.startswith("_")}
    for key in body:
        assert key in serve.PROFILE_FIELDS or key in ("custom", "address"), key
    serve._validate_address(template["address"])


def test_profile_rejects_unknown_field(server):
    status, resp = call(server, "PUT", "/api/profile", body={"essay": "hi"})
    assert status == 400
    assert "essay" in resp["error"]


def test_profile_rejects_non_object(server):
    status, resp = call(server, "PUT", "/api/profile", body=["nope"])
    assert status == 400


# ---------------------------------------------------------------------------
# Resume library and uploads

def test_library_empty_default(server):
    status, resp = call(server, "GET", "/api/library")
    assert status == 200
    assert resp == {"resumes": []}


def test_library_falls_back_to_template(server, tmp_path, monkeypatch):
    tdir = tmp_path / "templates"
    tdir.mkdir()
    (tdir / "library.template.json").write_text(json.dumps({"resumes": []}))
    monkeypatch.setattr(serve, "TEMPLATE_DIR", str(tdir))
    status, resp = call(server, "GET", "/api/library")
    assert status == 200
    assert resp == {"resumes": []}


def test_upload_resume(server, env):
    status, entry = upload(server)
    assert status == 200, entry
    assert entry["label"] == "SWE"
    assert entry["tags"] == ["swe", "backend"]
    # The original filename survives, sanitized, inside a per-id directory.
    # A recruiter sees this name when the agent uploads to an ATS.
    assert entry["file"] == f"files/{entry['id']}/JNK.pdf"
    assert (env / "files" / entry["id"] / "JNK.pdf").read_bytes() == b"%PDF-1.4 fake"
    status, resp = call(server, "GET", "/api/library")
    assert status == 200
    assert [r["id"] for r in resp["resumes"]] == [entry["id"]]


def test_upload_traversal_filename_stays_inside_user_dir(server, env, tmp_path):
    status, entry = upload(server, filename="../../evil.pdf")
    assert status == 200, entry
    # Path parts are stripped to a basename inside the per-id directory.
    assert entry["file"] == f"files/{entry['id']}/evil.pdf"
    assert entry["original_name"] == "../../evil.pdf"
    assert (env / "files" / entry["id"] / "evil.pdf").exists()
    # Nothing escaped the user dir: the only copy is the one under files/<id>/.
    escaped = [
        p for p in tmp_path.rglob("evil.pdf")
        if (env / "files") not in p.parents
    ]
    assert escaped == []


def test_upload_hostile_filename_sanitized(server, env):
    status, entry = upload(server, filename="my résumé (v2)!.PDF")
    assert status == 200, entry
    name = entry["file"].rsplit("/", 1)[1]
    assert name.lower().endswith(".pdf")
    assert re.fullmatch(r"[A-Za-z0-9._ -]+", name), name
    assert (env / "files" / entry["id"] / name).exists()


def test_upload_extensionless_filename_gets_pdf(server):
    status, entry = upload(server, filename="resume")
    assert status == 200, entry
    assert entry["file"].endswith("/resume.pdf")


def test_upload_rejects_non_pdf(server, env):
    status, resp = upload(server, filename="resume.pdf", filedata=b"MZ\x90\x00 exe bytes")
    assert status == 400
    assert resp["error"] == "not a PDF"
    assert not (env / "files").exists()


def test_upload_rejects_oversize_via_content_length(server):
    port = int(server.rsplit(":", 1)[1])
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        conn.putrequest("POST", "/api/resumes")
        conn.putheader("Content-Type", "multipart/form-data; boundary=x")
        conn.putheader("Content-Length", str(11 * 1024 * 1024))
        conn.endheaders()
        resp = conn.getresponse()
        assert resp.status == 413
        assert b"10 MB" in resp.read()
    finally:
        conn.close()


def test_upload_missing_file_part(server):
    body, headers = multipart("x.pdf", b"%PDF-1.4")
    body = body.replace(b'name="file"', b'name="other"')
    status, resp = call(server, "POST", "/api/resumes", data=body, headers=headers)
    assert status == 400


def test_resume_update(server):
    _, entry = upload(server)
    status, resp = call(
        server, "PUT", f"/api/resumes/{entry['id']}",
        body={"label": "ML resume", "tags": ["ml", "research"]},
    )
    assert status == 200
    assert resp["label"] == "ML resume"
    assert resp["tags"] == ["ml", "research"]


def test_resume_update_rejects_unknown_field(server):
    _, entry = upload(server)
    status, resp = call(server, "PUT", f"/api/resumes/{entry['id']}", body={"file": "x"})
    assert status == 400


def test_resume_update_missing_id(server):
    status, resp = call(server, "PUT", "/api/resumes/nope", body={"label": "x"})
    assert status == 404


def test_resume_delete_removes_entry_and_file(server, env):
    _, entry = upload(server)
    pdf = env / entry["file"]
    assert pdf.exists()
    status, resp = call(server, "DELETE", f"/api/resumes/{entry['id']}")
    assert status == 200
    assert not pdf.exists()
    # The per-id directory goes with it.
    assert not (env / "files" / entry["id"]).exists()
    _, lib = call(server, "GET", "/api/library")
    assert lib == {"resumes": []}


def test_resume_delete_missing_id(server):
    status, resp = call(server, "DELETE", "/api/resumes/nope")
    assert status == 404


# ---------------------------------------------------------------------------
# Queue: ATS detection and keys

def test_detect_greenhouse_board():
    ats, key = serve.detect_ats(serve.canonical_url(GH_BOARD))
    assert ats == "greenhouse"
    assert key == "greenhouse:acme:4001234"


def test_detect_greenhouse_job_boards_host():
    # Greenhouse serves both boards.greenhouse.io and
    # job-boards.greenhouse.io. Same job, same key.
    ats, key = serve.detect_ats(serve.canonical_url(GH_JOB_BOARDS))
    assert ats == "greenhouse"
    assert key == "greenhouse:acme:4001234"


def test_detect_greenhouse_job_boards_eu_host():
    url = "https://job-boards.eu.greenhouse.io/acme/jobs/4001234"
    ats, key = serve.detect_ats(serve.canonical_url(url))
    assert ats == "greenhouse"
    assert key == "greenhouse:acme:4001234"


def test_detect_greenhouse_gh_jid_embed():
    ats, key = serve.detect_ats(serve.canonical_url(GH_EMBED))
    assert ats == "greenhouse"
    assert key == "greenhouse:acme:4001234"


def test_detect_greenhouse_embed_job_app():
    url = "https://boards.greenhouse.io/embed/job_app?for=acme&token=4001234"
    ats, key = serve.detect_ats(serve.canonical_url(url))
    assert ats == "greenhouse"
    assert key == "greenhouse:acme:4001234"


def test_detect_lever():
    ats, key = serve.detect_ats(serve.canonical_url(LEVER_URL + "/apply?lever-source=x"))
    assert ats == "lever"
    assert key == f"lever:{LEVER_UUID}"


def test_detect_ashby():
    ats, key = serve.detect_ats(serve.canonical_url(ASHBY_URL))
    assert ats == "ashby"
    assert key == "ashby:acme:swe-intern-2027"


def test_detect_other():
    ats, key = serve.detect_ats(serve.canonical_url(OTHER_URL))
    assert ats == "other"
    assert key is None


def test_canonical_url_strips_tracking_and_slash():
    canon = serve.canonical_url("https://Jobs.Lever.co/acme/x/?utm_source=a&ref=b&gh_src=c")
    assert canon == "https://jobs.lever.co/acme/x"


# ---------------------------------------------------------------------------
# Queue: POST, dedupe

def test_queue_post_detects_ats_and_queues(server):
    status, resp = call(
        server, "POST", "/api/queue",
        body={"urls": [GH_BOARD, LEVER_URL, ASHBY_URL]},
    )
    assert status == 200
    assert resp["rejected"] == []
    got = {i["ats"]: i for i in resp["added"]}
    assert set(got) == {"greenhouse", "lever", "ashby"}
    for item in resp["added"]:
        assert item["status"] == "queued"
        assert item["id"] and item["added"] and item["key"]


def test_queue_post_unsupported_host_still_queued(server):
    status, resp = call(server, "POST", "/api/queue", body={"urls": [OTHER_URL]})
    assert status == 200
    assert resp["rejected"] == []
    item = resp["added"][0]
    assert item["ats"] == "other"
    assert item["status"] == "unsupported"


def test_queue_dedupes_referral_links(server):
    queue_one(server, GH_BOARD)
    status, resp = call(server, "POST", "/api/queue", body={"urls": [GH_REFERRAL]})
    assert status == 200
    assert resp["added"] == []
    assert resp["rejected"] == [{"url": GH_REFERRAL, "reason": "duplicate"}]


def test_queue_dedupes_job_boards_against_boards_host(server):
    queue_one(server, GH_BOARD)
    status, resp = call(server, "POST", "/api/queue", body={"urls": [GH_JOB_BOARDS]})
    assert status == 200
    assert resp["added"] == []
    assert resp["rejected"][0]["reason"] == "duplicate"


def test_queue_dedupes_gh_jid_against_board_form(server):
    queue_one(server, GH_BOARD)
    status, resp = call(server, "POST", "/api/queue", body={"urls": [GH_EMBED]})
    assert status == 200
    assert resp["added"] == []
    assert resp["rejected"][0]["reason"] == "duplicate"


def test_queue_dedupes_within_one_batch(server):
    status, resp = call(server, "POST", "/api/queue", body={"urls": [GH_BOARD, GH_REFERRAL]})
    assert status == 200
    assert len(resp["added"]) == 1
    assert resp["rejected"][0]["reason"] == "duplicate"


def test_queue_rejects_url_already_in_log(server, env):
    env.mkdir(parents=True, exist_ok=True)
    entry = {"url": LEVER_URL + "/apply", "status": "submitted"}
    (env / "log.jsonl").write_text(json.dumps(entry) + "\n")
    status, resp = call(server, "POST", "/api/queue", body={"urls": [LEVER_URL]})
    assert status == 200
    assert resp["added"] == []
    assert resp["rejected"] == [{"url": LEVER_URL, "reason": "already-applied"}]


def test_queue_rejects_log_entry_with_drifted_key(server, env):
    # A log line whose key format does not match serve.py's still blocks
    # a re-add, because the url-derived key is registered as well.
    env.mkdir(parents=True, exist_ok=True)
    entry = {"key": "greenhouse:4001234", "url": GH_BOARD, "event": "parked"}
    (env / "log.jsonl").write_text(json.dumps(entry) + "\n")
    status, resp = call(server, "POST", "/api/queue", body={"urls": [GH_BOARD]})
    assert status == 200
    assert resp["added"] == []
    assert resp["rejected"] == [{"url": GH_BOARD, "reason": "already-applied"}]


def test_queue_rejects_log_entry_with_key_only(server, env):
    env.mkdir(parents=True, exist_ok=True)
    entry = {"key": f"lever:{LEVER_UUID}", "event": "submitted"}
    (env / "log.jsonl").write_text(json.dumps(entry) + "\n")
    status, resp = call(server, "POST", "/api/queue", body={"urls": [LEVER_URL]})
    assert status == 200
    assert resp["added"] == []
    assert resp["rejected"] == [{"url": LEVER_URL, "reason": "already-applied"}]


def test_queue_post_rejects_bad_body(server):
    status, resp = call(server, "POST", "/api/queue", body={"urls": "not-a-list"})
    assert status == 400


def test_queue_post_rejects_non_http_url(server):
    status, resp = call(server, "POST", "/api/queue", body={"urls": ["file:///etc/passwd"]})
    assert status == 400


def test_queue_get_empty_default(server):
    status, resp = call(server, "GET", "/api/queue")
    assert status == 200
    assert resp == {"items": []}


# ---------------------------------------------------------------------------
# Queue: status state machine

LEGAL = [
    ("queued", "parked"),
    ("queued", "blocked"),
    ("queued", "unsupported"),
    ("queued", "skipped"),
    ("parked", "submitted"),
    ("parked", "skipped"),
]


@pytest.mark.parametrize("start,new", LEGAL)
def test_queue_legal_moves(server, start, new):
    item = queue_one(server, GH_BOARD)
    if start == "parked":
        status, _ = call(server, "PUT", f"/api/queue/{item['id']}", body={"status": "parked"})
        assert status == 200
    status, resp = call(server, "PUT", f"/api/queue/{item['id']}", body={"status": new})
    assert status == 200
    assert resp["status"] == new


def test_queue_illegal_move_names_transition(server):
    item = queue_one(server, GH_BOARD)
    status, resp = call(server, "PUT", f"/api/queue/{item['id']}", body={"status": "submitted"})
    assert status == 400
    assert "queued" in resp["error"]
    assert "submitted" in resp["error"]


def test_queue_unknown_status(server):
    item = queue_one(server, GH_BOARD)
    status, resp = call(server, "PUT", f"/api/queue/{item['id']}", body={"status": "done"})
    assert status == 400
    assert "unknown status" in resp["error"]


def test_queue_unknown_current_status_returns_400_not_500(server, env):
    # A hand-edited queue.json can hold a status this build never wrote.
    env.mkdir(parents=True, exist_ok=True)
    queue = {"items": [{"id": "x1", "url": GH_BOARD, "ats": "greenhouse", "status": "weird"}]}
    (env / "queue.json").write_text(json.dumps(queue))
    status, resp = call(server, "PUT", "/api/queue/x1", body={"status": "parked"})
    assert status == 400
    assert "illegal transition" in resp["error"]


def test_queue_terminal_is_terminal(server):
    item = queue_one(server, GH_BOARD)
    call(server, "PUT", f"/api/queue/{item['id']}", body={"status": "skipped"})
    status, resp = call(server, "PUT", f"/api/queue/{item['id']}", body={"status": "parked"})
    assert status == 400


def test_queue_reopen_returns_to_queued(server):
    item = queue_one(server, GH_BOARD)
    call(server, "PUT", f"/api/queue/{item['id']}", body={"status": "parked"})
    call(server, "PUT", f"/api/queue/{item['id']}", body={"status": "submitted"})
    status, resp = call(server, "PUT", f"/api/queue/{item['id']}", body={"reopen": True})
    assert status == 200
    assert resp["status"] == "queued"


def test_queue_reopen_rejected_when_not_terminal(server):
    item = queue_one(server, GH_BOARD)
    status, resp = call(server, "PUT", f"/api/queue/{item['id']}", body={"reopen": True})
    assert status == 400


# ---------------------------------------------------------------------------
# Queue: widened PUT fields

def test_queue_put_resume_id_valid(server):
    _, entry = upload(server)
    item = queue_one(server, GH_BOARD)
    status, resp = call(
        server, "PUT", f"/api/queue/{item['id']}", body={"resume_id": entry["id"]}
    )
    assert status == 200
    assert resp["resume_id"] == entry["id"]


def test_queue_put_resume_id_unknown(server):
    item = queue_one(server, GH_BOARD)
    status, resp = call(server, "PUT", f"/api/queue/{item['id']}", body={"resume_id": "nope"})
    assert status == 400


def test_queue_put_attempts(server):
    item = queue_one(server, GH_BOARD)
    status, resp = call(server, "PUT", f"/api/queue/{item['id']}", body={"attempts": 3})
    assert status == 200
    assert resp["attempts"] == 3
    for bad in (-1, "3", True):
        status, _ = call(server, "PUT", f"/api/queue/{item['id']}", body={"attempts": bad})
        assert status == 400, f"attempts={bad!r} accepted"


def test_queue_put_last_attempt(server):
    item = queue_one(server, GH_BOARD)
    status, resp = call(
        server, "PUT", f"/api/queue/{item['id']}",
        body={"last_attempt": "2026-09-18T10:00:00+00:00"},
    )
    assert status == 200
    assert resp["last_attempt"] == "2026-09-18T10:00:00+00:00"
    status, _ = call(server, "PUT", f"/api/queue/{item['id']}", body={"last_attempt": "not-a-date"})
    assert status == 400


def test_queue_put_notes(server):
    _, entry = upload(server)
    item = queue_one(server, GH_BOARD)
    notes = {
        "resume_id": entry["id"],
        "fields_pending": ["gpa"],
        "screeners_unanswered": ["why us"],
        "free_text": "left essay empty",
    }
    status, resp = call(server, "PUT", f"/api/queue/{item['id']}", body={"notes": notes})
    assert status == 200
    assert resp["notes"] == notes


def test_queue_put_notes_rejections(server):
    item = queue_one(server, GH_BOARD)
    for bad in (
        {"unknown_key": "x"},
        {"fields_pending": "gpa"},
        {"screeners_unanswered": [1]},
        {"free_text": 7},
        "not-an-object",
    ):
        status, _ = call(server, "PUT", f"/api/queue/{item['id']}", body={"notes": bad})
        assert status == 400, f"notes={bad!r} accepted"


def test_queue_put_rejects_unknown_top_level_field(server):
    item = queue_one(server, GH_BOARD)
    status, resp = call(server, "PUT", f"/api/queue/{item['id']}", body={"color": "red"})
    assert status == 400
    assert "color" in resp["error"]


def test_queue_put_missing_id(server):
    status, resp = call(server, "PUT", "/api/queue/nope", body={"status": "parked"})
    assert status == 404


def test_queue_delete(server):
    item = queue_one(server, GH_BOARD)
    status, resp = call(server, "DELETE", f"/api/queue/{item['id']}")
    assert status == 200
    _, queue = call(server, "GET", "/api/queue")
    assert queue == {"items": []}
    status, _ = call(server, "DELETE", f"/api/queue/{item['id']}")
    assert status == 404


# ---------------------------------------------------------------------------
# Log

def test_log_empty_when_absent(server):
    status, resp = call(server, "GET", "/api/log")
    assert status == 200
    assert resp == []


def test_log_parses_jsonl(server, env):
    env.mkdir(parents=True, exist_ok=True)
    lines = [
        json.dumps({"url": GH_BOARD, "status": "submitted"}),
        "",
        json.dumps({"url": LEVER_URL, "status": "parked"}),
    ]
    (env / "log.jsonl").write_text("\n".join(lines) + "\n")
    status, resp = call(server, "GET", "/api/log")
    assert status == 200
    assert len(resp) == 2
    assert resp[0]["url"] == GH_BOARD


# ---------------------------------------------------------------------------
# Static UI

def test_static_serves_index_and_assets(server, tmp_path, monkeypatch):
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<h1>apply</h1>")
    (ui / "apply-ui.js").write_text("void 0")
    monkeypatch.setattr(serve, "UI_DIR", str(ui))
    for path in ("/", "/ui/", "/ui/index.html"):
        with urllib.request.urlopen(server + path) as resp:
            assert resp.status == 200
            assert b"apply" in resp.read()
    with urllib.request.urlopen(server + "/ui/apply-ui.js") as resp:
        assert resp.status == 200
        assert "javascript" in resp.headers["Content-Type"]


def test_static_rejects_traversal(server, tmp_path, monkeypatch):
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("ok")
    secret = tmp_path / "secret.txt"
    secret.write_text("secret-content")
    monkeypatch.setattr(serve, "UI_DIR", str(ui))
    port = int(server.rsplit(":", 1)[1])
    for path in ("/ui/../secret.txt", "/ui/%2e%2e/secret.txt"):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        try:
            conn.request("GET", path)
            resp = conn.getresponse()
            body = resp.read()
            assert resp.status == 404, path
            assert b"secret-content" not in body
        finally:
            conn.close()


def test_unknown_route_404(server):
    status, resp = call(server, "GET", "/api/nope")
    assert status == 404
    assert resp["error"]


# ---------------------------------------------------------------------------
# Startup: port conflict and leak check

def test_port_in_use_exits_with_hint(tmp_path):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(1)
    port = sock.getsockname()[1]
    try:
        result = subprocess.run(
            [sys.executable, SERVE_PY, "--port", str(port)],
            env={**os.environ, "APPLY_USER_DIR": str(tmp_path / "user")},
            capture_output=True, text=True, timeout=30,
        )
    finally:
        sock.close()
    assert result.returncode != 0
    out = result.stdout + result.stderr
    assert "port" in out.lower()
    assert "--port" in out


def test_leak_check_blocks_unignored_user_dir(tmp_path):
    if shutil.which("git") is None:
        pytest.skip("git not installed")
    repo = tmp_path / "repo"
    udir = repo / "apply" / "user"
    udir.mkdir(parents=True)
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True, capture_output=True)
    result = subprocess.run(
        [sys.executable, SERVE_PY, "--port", "0"],
        env={**os.environ, "APPLY_USER_DIR": str(udir)},
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode != 0
    assert "gitignore" in (result.stdout + result.stderr).lower()
