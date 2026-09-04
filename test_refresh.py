import datetime

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
