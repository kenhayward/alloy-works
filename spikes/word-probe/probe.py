"""Throwaway. A small Word document that exercises the two mechanics ADR-0015 decided and nobody
has yet seen in Word:

  1. Fields refreshed on opening. A contents field, a list of figures, and "see Figure N on page P"
     references, in a document long enough that the page numbers matter, with settings.xml asking
     Word to update fields when the file opens. Page numbers in the footer use PAGE, which Word
     keeps current without asking.
  2. Equations as native Word equations (OMML), built from the same structural maths tree the PDF
     uses (spikes/publishing-engine/typst_data.py) - including the one subtlety the design names:
     OMML's sum, integral and limit contain their operand, where MathML sets it beside them.

Numbered display equations are tried two ways, because the design has not chosen: the number as a
SEQ field at a right tab stop (so a REF can point at it), and Word's own equation-array numbering.

Run inside the alloy-publishing-spike image, which has latex2mathml:
  docker run --rm -v "$(pwd)/spikes:/spikes" -w /spikes/word-probe alloy-publishing-spike python3 probe.py
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / 'publishing-engine'))
from cases import Text  # noqa: E402
from typst_data import math_tree  # noqa: E402

OUT = Path(__file__).parent / 'out'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

LARGE = set('∑∏∐∫∬∭∮⋃⋂⋁⋀')
RELATIONS = set('=<>≤≥≠≈≡∼≃∝→←↔⇒⇔∈∉⊂⊆⊃⊇')
LIMIT_OPS = {'lim', 'max', 'min', 'sup', 'inf', 'limsup', 'liminf'}


def esc(s: str) -> str:
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


# ---------------------------------------------------------------------------------------------
# The maths tree as OMML.
# ---------------------------------------------------------------------------------------------

def mrun(text: str, upright: bool = False, normal: bool = False) -> str:
    props = '<m:rPr><m:nor/></m:rPr>' if normal else ('<m:rPr><m:sty m:val="p"/></m:rPr>' if upright else '')
    return f'<m:r>{props}<m:t xml:space="preserve">{esc(text)}</m:t></m:r>'


def is_large(node) -> bool:
    return node.get('t') == 'o' and node.get('v') in LARGE


def is_limit(node) -> bool:
    return node.get('t') in ('o', 'i') and node.get('v') in LIMIT_OPS


def row(children: list) -> str:
    """A sequence, where a large operator or a limit takes in everything after it up to the next
    relation or the end of the group - OMML nests the operand inside; MathML sets it beside."""
    out, i = [], 0
    while i < len(children):
        node = children[i]
        base = node.get('base') if node.get('t') == 'attach' else node
        if base is not None and (is_large(base) or is_limit(base)):
            j = i + 1
            while j < len(children) and not (children[j].get('t') == 'o'
                                             and children[j].get('v') in RELATIONS):
                j += 1
            operand = row(children[i + 1:j])
            out.append(operator_with_operand(node, base, operand))
            i = j
            continue
        out.append(omml(node))
        i += 1
    return ''.join(out)


def operator_with_operand(node, base, operand: str) -> str:
    sub = omml(node['bottom']) if node.get('t') == 'attach' and 'bottom' in node else ''
    sup = omml(node['top']) if node.get('t') == 'attach' and 'top' in node else ''
    if is_large(base):
        loc = 'subSup' if base['v'] in '∫∬∭∮' else 'undOvr'
        hide = ('' if sub else '<m:subHide m:val="1"/>') + ('' if sup else '<m:supHide m:val="1"/>')
        return (f'<m:nary><m:naryPr><m:chr m:val="{base["v"]}"/><m:limLoc m:val="{loc}"/>{hide}'
                f'</m:naryPr><m:sub>{sub}</m:sub><m:sup>{sup}</m:sup><m:e>{operand}</m:e></m:nary>')
    name = mrun(base['v'], upright=True)
    if sub:
        name = f'<m:limLow><m:e>{name}</m:e><m:lim>{sub}</m:lim></m:limLow>'
    return f'<m:func><m:fName>{name}</m:fName><m:e>{operand}</m:e></m:func>'


def omml(n) -> str:
    t = n['t']
    if t == 'row':
        return row(n['c'])
    if t == 'lr':
        inner = n['c'][1:-1]
        return (f'<m:d><m:dPr><m:begChr m:val="{esc(n["c"][0]["v"])}"/>'
                f'<m:endChr m:val="{esc(n["c"][-1]["v"])}"/></m:dPr><m:e>{row(inner)}</m:e></m:d>')
    if t == 'i':
        return mrun(n['v'], upright=n.get('upright', False) or len(n['v']) > 1)
    if t in ('n', 'o'):
        return mrun(n['v'])
    if t == 'text':
        return mrun(n['v'], normal=True)
    if t == 'space':
        return mrun(' ')
    if t == 'frac':
        return f'<m:f><m:num>{omml(n["a"])}</m:num><m:den>{omml(n["b"])}</m:den></m:f>'
    if t == 'sqrt':
        return f'<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>{omml(n["c"])}</m:e></m:rad>'
    if t == 'root':
        return f'<m:rad><m:deg>{omml(n["i"])}</m:deg><m:e>{omml(n["c"])}</m:e></m:rad>'
    if t == 'attach':
        base = omml(n['base'])
        if 'top' in n and 'bottom' in n:
            return f'<m:sSubSup><m:e>{base}</m:e><m:sub>{omml(n["bottom"])}</m:sub><m:sup>{omml(n["top"])}</m:sup></m:sSubSup>'
        if 'top' in n:
            return f'<m:sSup><m:e>{base}</m:e><m:sup>{omml(n["top"])}</m:sup></m:sSup>'
        return f'<m:sSub><m:e>{base}</m:e><m:sub>{omml(n["bottom"])}</m:sub></m:sSub>'
    raise ValueError(f'no OMML for {t}')


def equation(latex: str) -> str:
    return f'<m:oMath>{omml(math_tree(latex))}</m:oMath>'


# ---------------------------------------------------------------------------------------------
# The document.
# ---------------------------------------------------------------------------------------------

def r(text: str) -> str:
    return f'<w:r><w:t xml:space="preserve">{esc(text)}</w:t></w:r>'


def field(instruction: str, cached: str) -> str:
    return ('<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
            f'<w:r><w:instrText xml:space="preserve"> {esc(instruction)} </w:instrText></w:r>'
            '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
            f'{r(cached)}<w:r><w:fldChar w:fldCharType="end"/></w:r>')


def p(content: str, style: str | None = None, extra_ppr: str = '') -> str:
    ppr = (f'<w:pStyle w:val="{style}"/>' if style else '') + extra_ppr
    return f'<w:p>{f"<w:pPr>{ppr}</w:pPr>" if ppr else ""}{content}</w:p>'


_bookmark = [0]


def bookmarked(name: str, content: str) -> str:
    _bookmark[0] += 1
    i = _bookmark[0]
    return f'<w:bookmarkStart w:id="{i}" w:name="{name}"/>{content}<w:bookmarkEnd w:id="{i}"/>'


def filler(t: Text, paragraphs: int) -> str:
    return ''.join(p(r(t.paragraph(6))) for _ in range(paragraphs))


def document() -> str:
    t = Text(21)
    body = [
        p(r('Word probe: fields and equations'), 'Title'),
        p(r('Contents'), 'TOCHeading'),
        p(field('TOC \\o "1-2" \\h \\z \\u', 'Right-click and choose Update Field, or accept the prompt on opening.')),
        p(r('List of figures'), 'TOCHeading'),
        p(field('TOC \\h \\z \\c "Figure"', 'Updated on opening.')),
        p(r('Fields'), 'Heading1'),
        p(r('The figure below is on a later page. It is ')
          + field('REF fig_chart \\h', '1') + r(', and it is on page ')
          + field('PAGEREF fig_chart \\h', '?') + r('. Both numbers should be right once fields update.')),
        filler(t, 7),
        p(r('A subsection on a later page'), 'Heading2'),
        filler(t, 8),
        p(r('Equations'), 'Heading1'),
        p(r('Inline, in running text: ') + equation('E = mc^2') + r(' - and a fraction ')
          + equation(r'\frac{a}{b}') + r(' and a root ') + equation(r'\sqrt{x^2 + y^2}') + r('.')),
        p(r('A sum in running text, which should keep its limits to the side: ')
          + equation(r'\sum_{i=1}^{n} x_i') + r('.')),
        p(r('Display, unnumbered: a sum whose operand sits inside it.')),
        p(f'<m:oMathPara>{equation(r"\sum_{i=1}^{n} x_i^2 = S")}</m:oMathPara>'),
        p(r('Display: an integral whose operand f(x) dx must be inside it, up to the equals sign.')),
        p(f'<m:oMathPara>{equation(r"\int_0^1 f(x)\,dx = F(1) - F(0)")}</m:oMathPara>'),
        p(r('Display: a limit with its condition beneath and stretchy brackets.')),
        p(f'<m:oMathPara>{equation(r"\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n = e")}</m:oMathPara>'),
        p(r('Numbered, way A - the number as a SEQ field at a right tab stop, so a reference can point at it:')),
        p('<w:r><w:tab/></w:r>' + equation(r'a^2 + b^2 = c^2') + '<w:r><w:tab/></w:r>'
          + bookmarked('eq_pythagoras', r('(') + field('SEQ Equation \\* ARABIC', '1') + r(')')),
          extra_ppr='<w:tabs><w:tab w:val="center" w:pos="4535"/><w:tab w:val="right" w:pos="9070"/></w:tabs>'),
        p(r('Numbered, way B - Word\'s own equation-array numbering:')),
        p('<m:oMathPara><m:oMath><m:eqArr><m:e>' + omml(math_tree(r'e^{i\pi} + 1 = 0'))
          + mrun('#') + '<m:d><m:e>' + mrun('2') + '</m:e></m:d></m:e></m:eqArr></m:oMath></m:oMathPara>'),
        p(r('A reference to the numbered equation above, which should read (1): ')
          + field('REF eq_pythagoras \\h', '(1)') + r('.')),
        filler(t, 6),
        p('<w:r><w:drawing><wp:inline><wp:extent cx="2286000" cy="1333500"/><wp:docPr id="1" name="Chart" '
          'descr="A plain grey rectangle standing in for a chart"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
          '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
          '<pic:nvPicPr><pic:cNvPr id="1" name="chart.png" descr="A plain grey rectangle standing in for a chart"/><pic:cNvPicPr/></pic:nvPicPr>'
          '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
          '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2286000" cy="1333500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
          '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'),
        p(bookmarked('fig_chart', r('Figure ') + field('SEQ Figure \\* ARABIC', '1')) + r('. A chart on a later page'), 'Caption'),
        filler(t, 3),
    ]
    sect = ('<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/>'
            '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" '
            'w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<w:document xmlns:w="{W}" xmlns:m="{M}" xmlns:r="{R}" '
            'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
            f'<w:body>{"".join(body)}{sect}</w:body></w:document>')


def style(sid: str, name: str, ppr: str = '', rpr: str = '', based: str = 'Normal', next_: str = 'Normal') -> str:
    return (f'<w:style w:type="paragraph" w:styleId="{sid}"><w:name w:val="{name}"/>'
            f'<w:basedOn w:val="{based}"/><w:next w:val="{next_}"/><w:qFormat/>'
            f'<w:pPr>{ppr}</w:pPr><w:rPr>{rpr}</w:rPr></w:style>')


def styles() -> str:
    fonts = '<w:rFonts w:ascii="Liberation Serif" w:hAnsi="Liberation Serif" w:cs="Liberation Serif"/>'
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<w:styles xmlns:w="{W}">'
            f'<w:docDefaults><w:rPrDefault><w:rPr>{fonts}<w:sz w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>'
            '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="280" w:lineRule="atLeast"/></w:pPr></w:pPrDefault></w:docDefaults>'
            '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
            + style('Title', 'Title', '<w:spacing w:after="240"/>', '<w:b/><w:sz w:val="40"/>')
            + style('TOCHeading', 'TOC Heading', '<w:keepNext/><w:spacing w:before="240"/>', '<w:b/><w:sz w:val="28"/>')
            + style('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="32"/>')
            + style('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="26"/>')
            + style('Caption', 'caption', '<w:spacing w:before="60" w:after="240"/>', '<w:i/><w:sz w:val="20"/>')
            + style('Footer', 'footer', '<w:jc w:val="center"/>', '<w:sz w:val="18"/>')
            + '</w:styles>')


def png_grey(w: int = 240, h: int = 140) -> bytes:
    import struct
    import zlib
    raw = b''.join(b'\x00' + bytes((200, 200, 200)) * w for _ in range(h))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


def main() -> None:
    OUT.mkdir(exist_ok=True)
    rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    parts = {
        '[Content_Types].xml': (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
            '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
            '</Types>'),
        '_rels/.rels': (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1" Type="{rel}/officeDocument" Target="word/document.xml"/></Relationships>'),
        'word/_rels/document.xml.rels': (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rIdStyles" Type="{rel}/styles" Target="styles.xml"/>'
            f'<Relationship Id="rIdSettings" Type="{rel}/settings" Target="settings.xml"/>'
            f'<Relationship Id="rIdFooter" Type="{rel}/footer" Target="footer1.xml"/>'
            f'<Relationship Id="rIdImg" Type="{rel}/image" Target="media/chart.png"/></Relationships>'),
        'word/document.xml': document(),
        'word/styles.xml': styles(),
        # The mechanic under test: Word offers to refresh every field when the document opens.
        'word/settings.xml': (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="{W}">'
                              '<w:updateFields w:val="true"/></w:settings>'),
        'word/footer1.xml': (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="{W}">'
                             + p(r('Page ') + field('PAGE', '1') + r(' of ') + field('NUMPAGES', '1'), 'Footer')
                             + '</w:ftr>'),
    }
    with zipfile.ZipFile(OUT / 'word-probe.docx', 'w', zipfile.ZIP_DEFLATED) as z:
        for name in ['[Content_Types].xml'] + [k for k in parts if k != '[Content_Types].xml']:
            z.writestr(name, parts[name])
        z.writestr('word/media/chart.png', png_grey())
    print('wrote', OUT / 'word-probe.docx')


if __name__ == '__main__':
    main()
