import datetime
import pathlib
import re

import pytest

import refresh


def test_verified_line_names_the_run_date():
    day = datetime.date(2026, 9, 3)
    assert refresh.verified_line(day) == "3 Sep 2026"


def test_rewrite_replaces_the_span_contents():
    html = '<p>checked on <span id="verified">31 Aug 2026</span> and so on</p>'
    out = refresh.rewrite_verified(html, datetime.date(2026, 9, 3))
    assert '<span id="verified">3 Sep 2026</span>' in out
    assert "31 Aug 2026" not in out


def test_rewrite_leaves_a_page_without_the_span_untouched():
    html = "<p>no span here</p>"
    assert refresh.rewrite_verified(html, datetime.date(2026, 9, 3)) == html


def test_the_real_page_carries_the_span():
    with open("index.html", encoding="utf-8") as fh:
        assert '<span id="verified">' in fh.read()


@pytest.mark.parametrize("title", [
    "Software Engineer Intern, Summer 2027",
    "2027 Summer Analyst Program",
    "New Grad Software Engineer",
    "Early Career Flight Software Engineer",
])
def test_early_matches_the_shapes_early_career_postings_actually_use(title):
    assert refresh.EARLY.search(title)


@pytest.mark.parametrize("title", [
    "Senior Software Engineer",
    "Staff Machine Learning Engineer",
    "Principal Product Manager",
])
def test_senior_titles_are_rejected_even_when_early_also_matches(title):
    assert refresh.SENIOR.search(title)


@pytest.mark.parametrize("title", [
    "Warehouse Associate",
    "Delivery Driver",
])
def test_junk_catches_shift_work_that_is_early_career_but_not_the_point(title):
    assert refresh.JUNK.search(title)


def test_us_matcher_accepts_a_domestic_location():
    assert refresh.US.search("Costa Mesa, California, United States")


def test_us_matcher_rejects_a_foreign_location():
    assert not refresh.US.search("Daresbury, England, United Kingdom")


def test_routing_sends_a_defense_prime_to_the_defense_section():
    assert "Defense" in refresh.route("Anduril", "2027 Early Career Flight Software Engineer")


def test_routing_falls_back_rather_than_dropping_an_unrecognised_row():
    assert refresh.route("Some Unknown LLC", "Coordinator, 2027") == refresh.FALLBACK


def test_norm_key_ignores_case_and_punctuation_so_a_retitled_row_is_not_duplicated():
    assert refresh.norm_key("Anduril", "Flight Software Engineer") == \
           refresh.norm_key("anduril", "Flight  Software  Engineer!")


def test_norm_key_still_separates_two_different_postings():
    """Equality alone would pass for a norm_key that returned a constant."""
    assert refresh.norm_key("Anduril", "Flight Software Engineer") != \
           refresh.norm_key("Anduril", "Mission Autonomy Engineer")
    assert refresh.norm_key("Anduril", "Flight Software Engineer") != \
           refresh.norm_key("Palantir", "Flight Software Engineer")


def _row_tag_date_formats():
    """The date formats refresh.py stamps into a row tag, read from its source.

    Read rather than imported because both live inline in main(), which cannot
    run without the network.
    """
    src = pathlib.Path(refresh.__file__).read_text(encoding="utf-8")
    new_tag = re.search(r'stamp_tag = .*strftime\("([^"]+)"\)', src)
    closed_tag = re.search(r"closed \{today:([^}]+)\}", src)
    assert new_tag, "no new-row date tag format found in refresh.py"
    assert closed_tag, "no closed-row date tag format found in refresh.py"
    return new_tag.group(1), closed_tag.group(1)


def test_row_date_tags_are_written_day_first():
    """app/rowindex.js parseTagDate reads these tags out of the page.

    Pinning the format on this side too means changing the Python fails a test
    here instead of silently zeroing freshness scoring in the browser.
    """
    day = datetime.date(2026, 9, 3)
    for fmt in _row_tag_date_formats():
        assert day.strftime(fmt) == "3 Sep"


def test_board_token_reads_a_greenhouse_url():
    assert refresh.board_token("https://job-boards.greenhouse.io/andurilindustries/jobs/500") == "andurilindustries"


def test_board_token_reads_a_lever_url():
    assert refresh.board_token("https://jobs.lever.co/palantir/abc") == "palantir"


def test_board_token_returns_none_for_a_board_we_cannot_enumerate():
    assert refresh.board_token("https://citi.wd5.myworkdayjobs.com/en-US/2/job/x") is None


# ---- the wide-net prune -------------------------------------------------
# This is the only operation in refresh.py that deletes rows, and it does it by
# string replacement on the published page. CI used to run a live dry run with
# --no-deep, which never reached this code at all.

def deep_page(count):
    """A page with a Deep sweep section holding `count` rows, oldest first."""
    rows = "".join(
        f'<tr><td class="co">Co{i}</td><td>Role {i}</td>'
        f'<td class="loc">CA</td><td><a href="https://x/{i}">Apply</a></td></tr>\n'
        for i in range(count)
    )
    return (
        '<h2>Defense &amp; national security</h2>\n'
        '<div class="wrap"><table>\n'
        '<tr><td class="co">Anduril</td><td>Keep me</td>'
        '<td class="loc">CA</td><td><a href="https://a/1">Apply</a></td></tr>\n'
        '</table></div>\n'
        '<h2>Deep sweep <span class="n">wide net</span></h2>\n'
        '<div class="wrap"><table>\n'
        "<tr><th>Company</th><th>Role</th></tr>\n"
        + rows +
        '</table></div>\n'
        "<h2>Trackers &amp; tooling</h2>\n"
        '<div class="wrap"><table>\n'
        '<tr><td class="co">SimplifyJobs</td><td>Tracker</td>'
        '<td class="loc">GitHub</td><td><a href="https://g/1">Open</a></td></tr>\n'
        "</table></div>\n"
    )


def test_prune_drops_the_oldest_rows_and_keeps_the_newest():
    out, pruned = refresh.prune_deep(deep_page(10), 4)
    assert pruned == 6
    for i in range(6):
        assert f"Role {i}<" not in out
    for i in range(6, 10):
        assert f"Role {i}<" in out
    assert out.count('<tr><td class="co">Co') == 4


def test_prune_leaves_a_section_under_the_limit_untouched():
    page = deep_page(4)
    out, pruned = refresh.prune_deep(page, 4)
    assert pruned == 0
    assert out == page


def test_prune_keeps_the_surrounding_markup_intact():
    out, _ = refresh.prune_deep(deep_page(10), 4)
    assert '<h2>Deep sweep <span class="n">wide net</span></h2>' in out
    assert out.count('<div class="wrap"><table>') == 3
    assert out.count("</table></div>") == 3
    assert "<tr><th>Company</th><th>Role</th></tr>" in out


def test_prune_never_touches_a_curated_section():
    out, _ = refresh.prune_deep(deep_page(10), 4)
    assert '<h2>Defense &amp; national security</h2>' in out
    assert "Anduril" in out and "Keep me" in out
    assert "SimplifyJobs" in out


def test_prune_leaves_a_page_with_no_deep_section_alone():
    page = "<h2>Defense</h2>\n<div class=\"wrap\"><table>\n</table></div>\n"
    out, pruned = refresh.prune_deep(page, 4)
    assert pruned == 0
    assert out == page
