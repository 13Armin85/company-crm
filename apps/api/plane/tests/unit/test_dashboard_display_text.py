"""Dashboard summaries must expose readable text, even for stored rich text."""

from plane.app.services.dashboard_widgets import _activity_value, _display_text


def test_rich_text_is_stripped_before_activity_truncation():
    value = '<p class="editor-paragraph-block" data-id="123">شرح تازه &amp; دقیق</p>'
    assert _activity_value(value, {}) == "شرح تازه & دقیق"
    assert _activity_value("<p>" + "الف" * 90 + "</p>", {}) == ("الف" * 90)[:80]


def test_dashboard_text_preserves_word_boundaries():
    assert _display_text("<p>خط اول</p><p>خط دوم</p>") == "خط اول خط دوم"
