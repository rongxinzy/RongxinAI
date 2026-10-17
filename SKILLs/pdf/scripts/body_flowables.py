#!/usr/bin/env python3
"""
body_flowables.py — Custom ReportLab flowables + page template for body PDFs.

Split out of render_body.py (issue #1069); re-exported there for compatibility.

Contents:
    CalloutBox      Highlighted insight box: coloured background + left bar
    BibliographyItem  Single hanging-indent bibliography entry "[N] text"
    BeautifulDoc    BaseDocTemplate with header/footer page decoration
"""

from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Flowable,
)
from reportlab.lib.colors import HexColor


class CalloutBox(Flowable):
    """Highlighted insight box: coloured background + 4px left accent bar."""

    def __init__(self, text: str, style, accent: str, bg: str):
        super().__init__()
        self._para   = Paragraph(text, style)
        self._accent = HexColor(accent)
        self._bg     = HexColor(bg)

    def wrap(self, aw, ah):
        self._w = aw
        _, ph = self._para.wrap(aw - 36, ah)
        self._h = ph + 22
        return aw, self._h

    def draw(self):
        c = self.canv
        c.setFillColor(self._bg)
        c.roundRect(0, 0, self._w, self._h, 5, fill=1, stroke=0)
        c.setFillColor(self._accent)
        c.rect(0, 0, 4, self._h, fill=1, stroke=0)
        self._para.drawOn(c, 18, 11)


class BibliographyItem(Flowable):
    """Single hanging-indent bibliography entry rendered as [N] text."""

    LABEL_W = 28

    def __init__(self, ref_id: str, text: str, style, dark: str):
        super().__init__()
        self._id    = ref_id
        self._text  = text
        self._style = style
        self._dark  = HexColor(dark)

    def wrap(self, aw, ah):
        self._w    = aw
        self._para = Paragraph(self._text, self._style)
        _, ph      = self._para.wrap(aw - self.LABEL_W, ah)
        self._h    = ph + 4
        return aw, self._h

    def draw(self):
        c = self.canv
        c.setFillColor(self._dark)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawString(0, self._h - 12, f"[{self._id}]")
        self._para.drawOn(c, self.LABEL_W, 2)


class BeautifulDoc(BaseDocTemplate):
    def __init__(self, path: str, tokens: dict, **kw):
        self._t = tokens
        super().__init__(path, **kw)
        fr = Frame(
            self.leftMargin, self.bottomMargin,
            self.width, self.height, id="body",
        )
        tmpl = PageTemplate(id="main", frames=fr, onPage=self._decorate)
        self.addPageTemplates([tmpl])

    def _decorate(self, canv, doc):
        t   = self._t
        lm  = doc.leftMargin
        rm  = doc.rightMargin
        pw  = doc.pagesize[0]
        ph  = doc.pagesize[1]
        top = ph - doc.topMargin

        canv.saveState()

        # Header accent rule
        canv.setStrokeColor(HexColor(t["accent"]))
        canv.setLineWidth(1.5)
        canv.line(lm, top + 12, pw - rm, top + 12)

        # Header: title (left) + date (right)
        canv.setFillColor(HexColor(t["muted"]))
        canv.setFont(t["font_body_rl"], t["size_meta"])
        canv.drawString(lm, top + 16, t["title"].upper())
        canv.drawRightString(pw - rm, top + 16, t.get("date", ""))

        # Footer rule
        canv.setStrokeColor(HexColor("#DDDDDD"))
        canv.setLineWidth(0.5)
        canv.line(lm, doc.bottomMargin - 12, pw - rm, doc.bottomMargin - 12)

        # Footer: author (left) + page number (right)
        canv.setFillColor(HexColor(t["muted"]))
        canv.setFont(t["font_body_rl"], t["size_meta"])
        canv.drawString(lm, doc.bottomMargin - 22, t.get("author", ""))
        canv.drawRightString(pw - rm, doc.bottomMargin - 22, str(doc.page))

        canv.restoreState()
