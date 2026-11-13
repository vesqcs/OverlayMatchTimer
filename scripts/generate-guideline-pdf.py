#!/usr/bin/env python3
"""Regenerate 'Overlay MatchTimer Guideline.pdf' from docs/guideline/GUIDELINE.md.

Requires: pip install reportlab
Does not call any network. Owner reviews the PDF before distribution.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
        Preformatted,
        KeepTogether,
    )
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
except ImportError:
    sys.stderr.write("Missing reportlab. Run: pip install reportlab\n")
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "guideline" / "GUIDELINE.md"
OUT = ROOT / "Overlay MatchTimer Guideline.pdf"


def strip_front_matter(text: str) -> str:
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            return text[end + 4 :].lstrip("\n")
    return text


def inline(md: str) -> str:
    md = md.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    md = re.sub(r"`([^`]+)`", r"<font face='Courier' size='8'>\1</font>", md)
    md = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", md)
    md = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", md)
    return md


def parse_table(lines: list[str]) -> list[list[str]]:
    rows = []
    for ln in lines:
        if re.match(r"^\|?\s*-+", ln):
            continue
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        rows.append(cells)
    return rows


def build():
    raw = strip_front_matter(SRC.read_text(encoding="utf-8"))
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="CoverTitle",
            parent=styles["Title"],
            fontSize=22,
            leading=26,
            alignment=TA_CENTER,
            spaceAfter=12,
        )
    )
    styles.add(
        ParagraphStyle(
            name="CoverMeta",
            parent=styles["Normal"],
            fontSize=11,
            leading=14,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#444444"),
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            name="H1Doc",
            parent=styles["Heading1"],
            fontSize=16,
            spaceBefore=16,
            spaceAfter=8,
            textColor=colors.HexColor("#111111"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="H2Doc",
            parent=styles["Heading2"],
            fontSize=13,
            spaceBefore=12,
            spaceAfter=6,
            textColor=colors.HexColor("#F5831F"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="H3Doc",
            parent=styles["Heading3"],
            fontSize=11,
            spaceBefore=8,
            spaceAfter=4,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BodyDoc",
            parent=styles["Normal"],
            fontSize=9.5,
            leading=13,
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BulletDoc",
            parent=styles["Normal"],
            fontSize=9.5,
            leading=13,
            leftIndent=14,
            spaceAfter=3,
        )
    )
    styles.add(
        ParagraphStyle(
            name="CodeDoc",
            parent=styles["Code"],
            fontSize=8,
            leading=10,
            backColor=colors.HexColor("#f4f4f4"),
            spaceBefore=4,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Cell",
            parent=styles["Normal"],
            fontSize=8,
            leading=10,
        )
    )
    styles.add(
        ParagraphStyle(
            name="FootNote",
            parent=styles["Normal"],
            fontSize=8,
            leading=10,
            textColor=colors.HexColor("#666666"),
            spaceBefore=4,
            spaceAfter=8,
        )
    )

    story = []
    story.append(Spacer(1, 40 * mm))
    story.append(Paragraph("OVERLAY MATCHTIMER", styles["CoverTitle"]))
    story.append(Paragraph("User Guideline", styles["CoverMeta"]))
    story.append(Paragraph("STATS PERFORM (internal)", styles["CoverMeta"]))
    story.append(Paragraph("Editable source → PDF · v1.7.0", styles["CoverMeta"]))
    story.append(Spacer(1, 20 * mm))
    story.append(
        Paragraph(
            "Generated from <font face='Courier'>docs/guideline/GUIDELINE.md</font>. "
            "Confirm security marking before external distribution.",
            styles["FootNote"],
        )
    )
    story.append(Spacer(1, 10 * mm))

    lines = raw.splitlines()
    i = 0
    in_code = False
    code_buf: list[str] = []
    table_buf: list[str] = []

    def flush_table():
        nonlocal table_buf
        if not table_buf:
            return
        rows = parse_table(table_buf)
        table_buf = []
        if not rows:
            return
        data = [[Paragraph(inline(c), styles["Cell"]) for c in row] for row in rows]
        col_n = max(len(r) for r in data)
        for r in data:
            while len(r) < col_n:
                r.append(Paragraph("", styles["Cell"]))
        width = 170 * mm
        col_w = [width / col_n] * col_n
        t = Table(data, colWidths=col_w, hAlign="LEFT")
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#222222")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cccccc")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                    (
                        "ROWBACKGROUNDS",
                        (0, 1),
                        (-1, -1),
                        [colors.white, colors.HexColor("#f7f7f7")],
                    ),
                ]
            )
        )
        story.append(KeepTogether([t, Spacer(1, 6)]))

    while i < len(lines):
        ln = lines[i]
        if ln.startswith("```"):
            if in_code:
                story.append(Preformatted("\n".join(code_buf), styles["CodeDoc"]))
                code_buf = []
                in_code = False
            else:
                flush_table()
                in_code = True
            i += 1
            continue
        if in_code:
            code_buf.append(ln)
            i += 1
            continue
        if ln.strip().startswith("|"):
            table_buf.append(ln)
            i += 1
            continue
        else:
            flush_table()

        if not ln.strip():
            story.append(Spacer(1, 3))
            i += 1
            continue
        if ln.startswith("# "):
            # skip duplicate H1 on cover-like first heading after front matter already used
            story.append(Paragraph(inline(ln[2:].strip()), styles["H1Doc"]))
        elif ln.startswith("## "):
            story.append(Paragraph(inline(ln[3:].strip()), styles["H2Doc"]))
        elif ln.startswith("### "):
            story.append(Paragraph(inline(ln[4:].strip()), styles["H3Doc"]))
        elif ln.startswith("> "):
            story.append(Paragraph(inline(ln[2:].strip()), styles["FootNote"]))
        elif ln.startswith("- ") or ln.startswith("* "):
            story.append(Paragraph("• " + inline(ln[2:].strip()), styles["BulletDoc"]))
        elif re.match(r"^\d+\.\s+", ln):
            story.append(Paragraph(inline(ln.strip()), styles["BulletDoc"]))
        elif ln.strip() == "---":
            story.append(Spacer(1, 6))
        else:
            story.append(Paragraph(inline(ln.strip()), styles["BodyDoc"]))
        i += 1
    flush_table()

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#888888"))
        canvas.drawString(18 * mm, 10 * mm, "Overlay MatchTimer Guideline · v1.7.0 · internal")
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, str(doc.page))
        canvas.restoreState()

    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=14 * mm,
        bottomMargin=16 * mm,
        title="Overlay MatchTimer Guideline",
        author="Stats Perform / Overlay MatchTimer maintainers",
    )
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    if not SRC.exists():
        sys.stderr.write(f"Missing source: {SRC}\n")
        sys.exit(1)
    build()
