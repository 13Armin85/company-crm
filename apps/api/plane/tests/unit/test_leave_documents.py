"""The downloaded Word form and browser preview must keep the same meaningful content."""

from io import BytesIO

import pytest

from plane.app.services import leave_documents as documents

pytestmark = pytest.mark.unit
pytest.importorskip("docx")

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


def save(document):
    output = BytesIO()
    document.save(output)
    return output.getvalue()


def test_sample_template_has_every_data_slot_and_persian_rtl_layout():
    data = documents.build_sample_template()
    report = documents.validate_template(data)
    assert report["issues"] == []
    assert set(report["placeholders"]) == set(documents.PLACEHOLDERS)
    doc = Document(BytesIO(data))
    assert doc.tables[0]._tbl.tblPr.find(qn("w:bidiVisual")) is not None
    assert all(p._p.pPr.find(qn("w:bidi")) is not None for p in documents._paragraphs(doc))


def test_filling_replaces_split_and_hyperlink_slots_in_body_table_and_header():
    doc = Document()
    paragraph = doc.add_paragraph("درخواست: ")
    paragraph.add_run("{{employee_")
    paragraph.add_run("name}}")
    link = OxmlElement("w:hyperlink")
    run = OxmlElement("w:r")
    text = OxmlElement("w:t")
    text.text = "{{request_number}}"
    run.append(text)
    link.append(run)
    doc.add_paragraph()._p.append(link)
    doc.add_table(rows=1, cols=1).cell(0, 0).text = "دلیل: {{reason}}"
    doc.sections[0].header.paragraphs[0].text = "واحد: {{unit}}"
    values = {"employee_name": "علی رضایی", "request_number": "LRQ-25", "reason": "مراجعه به پزشک", "unit": "پشتیبانی"}
    filled = documents.render(save(doc), values)
    result = Document(BytesIO(filled))
    assert all("{{" not in documents._paragraph_text(p) for p in documents._paragraphs(result))
    html = documents.to_html(filled)
    assert all(value in html for value in values.values())


def test_preview_escapes_user_text_and_keeps_unsigned_signature_location():
    values = {key: f"مقدار {title}" for key, (title, _) in documents.PLACEHOLDERS.items()}
    values["reason"] = '<script>alert("x")</script>\nتوضیح تکمیلی'
    filled = documents.render(documents.build_sample_template(), values)
    html = documents.to_html(filled)
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "<br>توضیح تکمیلی" in html
    assert documents.SIGNATURE_PREVIEW_TEXT in html
    assert "{{" not in html
