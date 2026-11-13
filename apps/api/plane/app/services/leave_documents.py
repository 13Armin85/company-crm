"""Leave request Word documents (ticket 6): template validation, filling and HTML preview.

Pure functions over bytes; nothing here touches the database. ``leave_requests``
decides *which* values go into a document and *when* a signature may be placed.

Placeholders are written in the template as ``{{ key }}``. Only the keys in
``PLACEHOLDERS`` exist; there is deliberately no leave category placeholder.
The source ``.docx`` stays the master copy: the preview is an HTML rendering of
the filled document, and users never edit the Word file in the system.
"""

import base64
import html
import re
import zipfile
from copy import deepcopy
from io import BytesIO

from rest_framework.exceptions import APIException

# python-docx is needed only by the Word features. A deployment whose image was built before the
# dependency was added must keep running: the rest of the API never imports it, and these
# functions answer with a clear 503 instead of the whole server failing to start.
try:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
    from docx.shared import Cm
    from docx.text.paragraph import Paragraph

    DOCX_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised by test_missing_docx_library_does_not_break_the_api
    Document = WD_ALIGN_PARAGRAPH = qn = Cm = Paragraph = None
    DOCX_AVAILABLE = False

MAX_TEMPLATE_BYTES = 5 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024
DOCX_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
SIGNATURE_KEY = "signature"
SIGNATURE_WIDTH_CM = 4


class DocxUnavailable(APIException):
    status_code = 503
    default_detail = (
        "کتابخانهٔ ساخت فایل Word (python-docx) روی سرور نصب نیست؛ "
        "مدیر سامانه باید ایمیج API را با requirements به‌روز دوباره بسازد."
    )
    default_code = "docx_unavailable"


def require_docx():
    if not DOCX_AVAILABLE:
        raise DocxUnavailable()


SIGNATURE_PREVIEW_TEXT = "[محل درج تصویر امضا]"

# key: (Persian title, required in every template)
PLACEHOLDERS = {
    "employee_name": ("نام و نام خانوادگی درخواست‌دهنده", True),
    "employee_id": ("شناسهٔ کارمندی یا کاربری", True),
    "unit": ("واحد سازمانی", False),
    "start": ("شروع بازهٔ مرخصی (تاریخ)", True),
    "end": ("پایان بازهٔ مرخصی (تاریخ)", True),
    "mode": ("شیوهٔ مدت (روزانه یا ساعتی)", True),
    "start_time": ("ساعت شروع (فقط مرخصی ساعتی)", False),
    "end_time": ("ساعت پایان (فقط مرخصی ساعتی)", False),
    "duration": ("مدت محاسبه‌شده", True),
    "reason": ("دلیل", False),
    "substitute": ("جانشین", False),
    "submitted_at": ("تاریخ ثبت", False),
    "request_number": ("شمارهٔ درخواست", True),
    SIGNATURE_KEY: ("جایگاه تصویر امضا", True),
}
REQUIRED_PLACEHOLDERS = [key for key, (_, required) in PLACEHOLDERS.items() if required]
TOKEN = re.compile(r"\{\{(.*?)\}\}", re.S)
VALID_KEY = re.compile(r"^[a-z][a-z_]*$")


class TemplateError(Exception):
    """The file cannot be used as a template at all (corrupt, not .docx, …)."""


def catalog():
    return [{"key": key, "title": title, "required": required} for key, (title, required) in PLACEHOLDERS.items()]


# ---------------------------------------------------------------- loading


def open_docx(data):
    """Open ``data`` as a Word document or raise ``TemplateError`` with a Persian message."""
    require_docx()
    if not data:
        raise TemplateError("فایل خالی است.")
    if len(data) > MAX_TEMPLATE_BYTES:
        raise TemplateError("حجم فایل قالب بیش از ۵ مگابایت است.")
    stream = BytesIO(data)
    if not zipfile.is_zipfile(stream):
        raise TemplateError("فایل خراب است یا قالب Word (.docx) نیست.")
    try:
        with zipfile.ZipFile(stream) as archive:
            names = archive.namelist()
            if "word/document.xml" not in names or "[Content_Types].xml" not in names:
                raise TemplateError("فایل خراب است یا قالب Word (.docx) نیست.")
            if sum(info.file_size for info in archive.infolist()) > MAX_UNCOMPRESSED_BYTES:
                raise TemplateError("محتوای فشردهٔ فایل بیش از حد مجاز است.")
            if any(name.lower().endswith("vbaproject.bin") for name in names):
                raise TemplateError("قالب دارای ماکرو پذیرفته نمی‌شود؛ فایل .docx بدون ماکرو بارگذاری کنید.")
    except zipfile.BadZipFile as exc:
        raise TemplateError("فایل خراب است یا قالب Word (.docx) نیست.") from exc
    try:
        document = Document(BytesIO(data))
    except ValueError as exc:
        raise TemplateError("این فایل سند Word (.docx) نیست؛ قالب‌های .doc، .docm و .dotx پذیرفته نمی‌شوند.") from exc
    except Exception as exc:  # python-docx raises several low-level errors for broken packages
        raise TemplateError("فایل خراب است و باز نمی‌شود.") from exc
    if document.part.content_type != DOCX_MAIN:
        raise TemplateError("این فایل سند Word (.docx) نیست.")
    return document


def _containers(document):
    """(xml element, python-docx parent with ``.part``) for the body, headers and footers."""
    yield document.element.body, document._body
    seen = set()
    for section in document.sections:
        for item in (
            section.header,
            section.first_page_header,
            section.even_page_header,
            section.footer,
            section.first_page_footer,
            section.even_page_footer,
        ):
            if item.is_linked_to_previous:
                continue
            element = item._element
            if id(element) in seen:
                continue
            seen.add(id(element))
            yield element, item


def _paragraphs(document):
    """Every paragraph, including tables, nested tables, text boxes, headers and footers."""
    for element, parent in _containers(document):
        for p in element.iter(qn("w:p")):
            yield Paragraph(p, parent)


def _paragraph_text(paragraph):
    return "".join(node.text or "" for node in paragraph._p.iter(qn("w:t")))


# ---------------------------------------------------------------- validation


def scan(document):
    """``(keys found in order, problems)`` where problems are invalid or unclosed tokens."""
    found, problems = [], []
    for paragraph in _paragraphs(document):
        text = _paragraph_text(paragraph)
        if "{{" not in text and "}}" not in text:
            continue
        for match in TOKEN.finditer(text):
            key = match.group(1).strip()
            if VALID_KEY.match(key):
                found.append(key)
            else:
                problems.append(f"جایگاه «{match.group(0)[:60]}» نامعتبر است؛ فقط کلیدهای لاتین تعریف‌شده مجازند.")
        rest = TOKEN.sub("", text)
        if "{{" in rest or "}}" in rest:
            problems.append(f"در بند «{text.strip()[:60]}» آکولاد باز یا بسته‌ای بدون جفت وجود دارد.")
    return found, problems


def validate_template(data):
    """Validation report: ``{"placeholders": [...], "issues": [{"code", "level", "message"}]}``.

    Any ``error`` issue makes the template unusable (it can never be activated).
    """
    try:
        document = open_docx(data)
    except TemplateError as exc:
        return {"placeholders": [], "issues": [{"code": "file", "level": "error", "message": str(exc)}]}
    found, problems = scan(document)
    issues = [{"code": "invalid", "level": "error", "message": message} for message in problems]
    for key in sorted(set(found) - set(PLACEHOLDERS)):
        issues.append(
            {
                "code": "unknown",
                "level": "error",
                "message": f"جایگاه «{{{{{key}}}}}» ناشناخته است و در فهرست جایگاه‌های مجاز نیست.",
            }
        )
    for key in REQUIRED_PLACEHOLDERS:
        if key not in found:
            issues.append(
                {
                    "code": "missing",
                    "level": "error",
                    "message": f"جایگاه الزامی «{{{{{key}}}}}» ({PLACEHOLDERS[key][0]}) در قالب نیست؛ قالب ناقص است.",
                }
            )
    ordered = list(dict.fromkeys(key for key in found if key in PLACEHOLDERS))
    return {"placeholders": ordered, "issues": issues}


# ---------------------------------------------------------------- filling


def _replace_text(text, values):
    return TOKEN.sub(lambda match: str(values.get(match.group(1).strip(), "")), text)


def _fill_paragraph(paragraph, values, signature):
    runs = paragraph.runs
    text = "".join(run.text for run in runs)
    if "{{" not in text:
        return
    keys = [match.group(1).strip() for match in TOKEN.finditer(text)]
    # Keep run formatting when every placeholder sits inside a single run and no picture is needed.
    if SIGNATURE_KEY not in keys and all(
        "{{" not in TOKEN.sub("", run.text) and "}}" not in TOKEN.sub("", run.text) for run in runs
    ):
        for run in runs:
            if "{{" in run.text:
                run.text = _replace_text(run.text, values)
        if "{{" not in "".join(run.text for run in paragraph.runs):
            return
    # Placeholder split across runs (Word does this often): rebuild with the first run's format.
    template = deepcopy(runs[0]._r) if runs else None
    for run in runs:
        run._r.getparent().remove(run._r)
    pieces, cursor = [], 0
    for match in TOKEN.finditer(text):
        pieces.append(("text", text[cursor : match.start()]))
        key = match.group(1).strip()
        pieces.append(("signature", "") if key == SIGNATURE_KEY else ("text", str(values.get(key, ""))))
        cursor = match.end()
    pieces.append(("text", text[cursor:]))
    for kind, value in pieces:
        if kind == "text" and not value:
            continue
        run = paragraph.add_run()
        if template is not None:
            properties = template.find(qn("w:rPr"))
            if properties is not None:
                run._r.insert(0, deepcopy(properties))
        if kind == "text":
            run.text = value
        elif signature:
            run.add_picture(BytesIO(signature), width=Cm(SIGNATURE_WIDTH_CM))
        else:
            run.text = SIGNATURE_PREVIEW_TEXT


def render(template_bytes, values, signature=None):
    """Fill a template. ``signature`` is the image bytes, or None for an unsigned preview."""
    document = open_docx(template_bytes)
    for paragraph in list(_paragraphs(document)):
        _fill_paragraph(paragraph, values, signature)
    output = BytesIO()
    document.save(output)
    return output.getvalue()


# ---------------------------------------------------------------- preview


ALIGN = (
    {
        WD_ALIGN_PARAGRAPH.CENTER: "center",
        WD_ALIGN_PARAGRAPH.RIGHT: "right",
        WD_ALIGN_PARAGRAPH.LEFT: "left",
        WD_ALIGN_PARAGRAPH.JUSTIFY: "justify",
    }
    if DOCX_AVAILABLE
    else {}
)
IMAGE_TYPES = {"image/png", "image/jpeg"}


def _image_html(run, part):
    out = []
    for blip in run._r.iter(qn("a:blip")):
        rel = blip.get(qn("r:embed"))
        target = part.related_parts.get(rel) if rel else None
        if target is None or target.content_type not in IMAGE_TYPES:
            continue
        data = base64.b64encode(target.blob).decode("ascii")
        out.append(f'<img alt="تصویر" src="data:{target.content_type};base64,{data}" style="max-width:6cm">')
    return "".join(out)


def _run_html(run, part):
    content = html.escape(run.text).replace("\n", "<br>") + _image_html(run, part)
    if not content:
        return ""
    if run.bold:
        content = f"<strong>{content}</strong>"
    if run.italic:
        content = f"<em>{content}</em>"
    if run.underline:
        content = f"<u>{content}</u>"
    if run.font.size:
        content = f'<span style="font-size:{run.font.size.pt:.0f}pt">{content}</span>'
    return content


def _paragraph_html(paragraph, part):
    body = "".join(_run_html(run, part) for run in paragraph.runs) or "&nbsp;"
    align = ALIGN.get(paragraph.alignment)
    style = f' style="text-align:{align}"' if align else ""
    return f'<p dir="auto"{style}>{body}</p>'


def _table_html(table, part):
    rows = []
    for row in table.rows:
        cells = []
        for cell in row.cells:
            inner = "".join(_block_html(child, cell, part) for child in cell._tc.iterchildren())
            cells.append(f"<td>{inner}</td>")
        rows.append(f"<tr>{''.join(cells)}</tr>")
    return f"<table>{''.join(rows)}</table>"


def _block_html(element, parent, part):
    from docx.table import Table

    if element.tag == qn("w:p"):
        return _paragraph_html(Paragraph(element, parent), part)
    if element.tag == qn("w:tbl"):
        return _table_html(Table(element, parent), part)
    return ""


def _container_html(element, parent):
    return "".join(_block_html(child, parent, parent.part) for child in element.iterchildren())


PREVIEW_STYLE = (
    "body{font-family:Vazirmatn,Tahoma,sans-serif;margin:0;padding:24px;background:#fff;color:#111;line-height:1.8}"
    "main{max-width:21cm;margin:0 auto}table{border-collapse:collapse;width:100%;margin:8px 0}"
    "td{border:1px solid #999;padding:4px 8px;vertical-align:top}p{margin:4px 0}"
    "header,footer{color:#444;font-size:90%;border-bottom:1px dashed #ccc;margin-bottom:12px}"
    "footer{border-bottom:0;border-top:1px dashed #ccc;margin-top:12px}"
)


def to_html(docx_bytes):
    """Static, script-free HTML of a filled document for the in-browser preview."""
    document = open_docx(docx_bytes)
    section = document.sections[0] if document.sections else None
    header = footer = ""
    if section is not None:
        if not section.header.is_linked_to_previous:
            header = f"<header>{_container_html(section.header._element, section.header)}</header>"
        if not section.footer.is_linked_to_previous:
            footer = f"<footer>{_container_html(section.footer._element, section.footer)}</footer>"
    body = _container_html(document.element.body, document._body)
    return (
        '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">'
        f"<style>{PREVIEW_STYLE}</style></head><body><main>{header}{body}{footer}</main></body></html>"
    )


def build_sample_template(keys=None, extra_text=""):
    """A minimal valid template (used by tests and as a downloadable starting point for admins)."""
    require_docx()
    keys = list(PLACEHOLDERS) if keys is None else keys
    document = Document()
    document.add_heading("فرم درخواست مرخصی", level=1)
    table = document.add_table(rows=0, cols=2)
    for key in keys:
        if key == SIGNATURE_KEY:
            continue
        row = table.add_row().cells
        row[0].text = PLACEHOLDERS.get(key, (key, False))[0]
        row[1].text = f"{{{{{key}}}}}"
    if extra_text:
        document.add_paragraph(extra_text)
    if SIGNATURE_KEY in keys:
        document.add_paragraph("امضای درخواست‌دهنده:")
        document.add_paragraph(f"{{{{{SIGNATURE_KEY}}}}}")
    output = BytesIO()
    document.save(output)
    return output.getvalue()
