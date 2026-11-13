#!/usr/bin/env python3
"""Regenerate TESTING-TUESDAY.pdf from TESTING-TUESDAY.md."""
from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from reportlab.lib import colors
except ImportError:
    sys.stderr.write("Missing reportlab. Run: pip install reportlab\n")
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "TESTING-TUESDAY.md"
OUT = ROOT / "TESTING-TUESDAY.pdf"


def inline(md: str) -> str:
    md = md.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    md = re.sub(r"`([^`]+)`", r"<font face='Courier' size='8'>\1</font>", md)
    md = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", md)
    return md


def build():
    text = SRC.read_text(encoding="utf-8")
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="H1", parent=styles["Heading1"], fontSize=14, spaceAfter=8))
    styles.add(ParagraphStyle(name="H2", parent=styles["Heading2"], fontSize=11, textColor=colors.HexColor("#F5831F"), spaceBefore=10, spaceAfter=4))
    styles.add(ParagraphStyle(name="Body", parent=styles["Normal"], fontSize=9, leading=12, spaceAfter=4))
    styles.add(ParagraphStyle(name="Cell", parent=styles["Normal"], fontSize=7.5, leading=9))

    story = []
    lines = text.splitlines()
    i = 0
    table_buf = []

    def flush_table():
        nonlocal table_buf
        if not table_buf:
            return
        rows = []
        for ln in table_buf:
            if re.match(r"^\|?\s*-+", ln):
                continue
            rows.append([c.strip() for c in ln.strip().strip("|").split("|")])
        table_buf = []
        if not rows:
            return
        data = [[Paragraph(inline(c), styles["Cell"]) for c in r] for r in rows]
        n = max(len(r) for r in data)
        for r in data:
            while len(r) < n:
                r.append(Paragraph("", styles["Cell"]))
        # weight first cols for checklists
        widths = [12 * mm, 55 * mm, 70 * mm, 10 * mm, 25 * mm][:n]
        while len(widths) < n:
            widths.append(20 * mm)
        scale = (170 * mm) / sum(widths)
        widths = [w * scale for w in widths]
        t = Table(data, colWidths=widths, hAlign="LEFT")
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#222")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#ccc")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 3),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                    ("TOPPADDING", (0, 0), (-1, -1), 2),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ]
            )
        )
        story.append(t)
        story.append(Spacer(1, 6))

    while i < len(lines):
        ln = lines[i]
        if ln.strip().startswith("|"):
            table_buf.append(ln)
            i += 1
            continue
        flush_table()
        if not ln.strip() or ln.strip() == "---":
            i += 1
            continue
        if ln.startswith("# "):
            story.append(Paragraph(inline(ln[2:]), styles["H1"]))
        elif ln.startswith("## "):
            story.append(Paragraph(inline(ln[3:]), styles["H2"]))
        else:
            story.append(Paragraph(inline(ln), styles["Body"]))
        i += 1
    flush_table()

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#888"))
        canvas.drawString(16 * mm, 10 * mm, "TESTING-TUESDAY · Overlay MatchTimer")
        canvas.drawRightString(A4[0] - 16 * mm, 10 * mm, str(doc.page))
        canvas.restoreState()

    doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=12 * mm, bottomMargin=14 * mm)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"Wrote {OUT.name}")


if __name__ == "__main__":
    build()
