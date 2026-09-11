"""The recommended shape: the resolved document as data, rendered by one fixed Typst template.

Nothing here writes Typst source. A document becomes doc.json; template.typ - which never changes
per document - reads it with json() and builds the page from values. A string from the content
model arrives in Typst as a string and is set as text, so there is no escaping to get wrong and no
way for content to become code.

Equations are the hard part, because the content model stores LaTeX (CNT-044) and the obvious route
into Typst is to translate LaTeX to Typst math source and eval it - which reopens exactly the hole
this shape exists to close. So LaTeX goes to MathML (which Word needs anyway, on its way to OMML),
and MathML becomes a small structural tree the template assembles from math.frac, math.attach and
the rest. An element the tree does not know fails the build, as CNT-049 requires, rather than
rendering as source.
"""

from __future__ import annotations

import json
import shutil
# The LaTeX comes from content, so the MathML made from it is parsed with a hardened parser.
import defusedxml.ElementTree as ET
from pathlib import Path

from latex2mathml.converter import convert

from cases import Bullets, Figure, Footnote, Heading, Lang, Para, Table
from cases_more import (BookDoc, Contents, FigureList, Math, References, Region, XRef)

HERE = Path(__file__).parent


class UnsupportedMath(ValueError):
    pass


def _local(tag: str) -> str:
    return tag.split('}')[-1]


def math_tree(latex: str) -> dict:
    return _node(ET.fromstring(convert(latex)))


def _node(el) -> dict:
    tag = _local(el.tag)
    kids = [k for k in el if _local(k.tag) != 'annotation']
    text = (el.text or '').strip()
    if tag in ('math', 'mrow', 'mstyle', 'semantics'):
        items = [_node(k) for k in kids]
        fenced = (len(kids) >= 2 and _local(kids[0].tag) == 'mo' and _local(kids[-1].tag) == 'mo'
                  and kids[0].get('stretchy') == 'true' and kids[-1].get('stretchy') == 'true')
        return {'t': 'lr' if fenced else 'row', 'c': items}
    if tag == 'mi':
        return {'t': 'i', 'v': text, 'upright': el.get('mathvariant') == 'normal'}
    if tag == 'mn':
        return {'t': 'n', 'v': text}
    if tag == 'mo':
        return {'t': 'o', 'v': text}
    if tag == 'mtext':
        return {'t': 'text', 'v': el.text or ''}
    if tag == 'mspace':
        return {'t': 'space'}
    if tag == 'mfrac':
        return {'t': 'frac', 'a': _node(kids[0]), 'b': _node(kids[1])}
    if tag == 'msqrt':
        return {'t': 'sqrt', 'c': {'t': 'row', 'c': [_node(k) for k in kids]}}
    if tag == 'mroot':
        return {'t': 'root', 'c': _node(kids[0]), 'i': _node(kids[1])}
    if tag in ('msup', 'msub', 'msubsup', 'munder', 'mover', 'munderover'):
        d = {'t': 'attach', 'base': _node(kids[0]), 'limits': tag.startswith('mu')}
        if tag in ('msub', 'munder'):
            d['bottom'] = _node(kids[1])
        elif tag in ('msup', 'mover'):
            d['top'] = _node(kids[1])
        else:
            d['bottom'], d['top'] = _node(kids[1]), _node(kids[2])
        return d
    raise UnsupportedMath(f'MathML <{tag}> has no rendering; failing rather than showing source')


def _parts(parts) -> list:
    if isinstance(parts, str):
        return [parts]
    out = []
    for p in parts:
        if isinstance(p, Footnote):
            out.append({'t': 'fn', 'parts': _parts(p.text)})
        elif isinstance(p, Lang):
            out.append({'t': 'lang', 'lang': p.lang, 'text': p.text})
        elif isinstance(p, Math):
            out.append({'t': 'math', 'alt': p.alt, 'tree': math_tree(p.latex)})
        elif isinstance(p, XRef):
            out.append({'t': 'xref', 'target': p.target})
        else:
            out.append(p)
    return out


def _block(b) -> dict:
    if isinstance(b, Region):
        return {'t': 'region', 'kind': b.kind, 'blocks': [_block(x) for x in b.blocks]}
    if isinstance(b, Heading):
        return {'t': 'h', 'level': b.level, 'parts': _parts(b.text)}
    if isinstance(b, Para):
        return {'t': 'p', 'parts': _parts(b.parts)}
    if isinstance(b, Bullets):
        return {'t': 'ul', 'items': [_parts(i) for i in b.items]}
    if isinstance(b, Math):
        return {'t': 'eq', 'alt': b.alt, 'numbered': b.numbered, 'tree': math_tree(b.latex)}
    if isinstance(b, Table):
        return {'t': 'table', 'caption': _parts(b.caption), 'header': b.header,
                'rows': [[_parts(c) for c in row] for row in b.rows]}
    if isinstance(b, Figure):
        return {'t': 'figure', 'src': b.src, 'alt': b.alt, 'caption': _parts(b.caption),
                'id': getattr(b, 'id', '') or ''}
    if isinstance(b, Contents):
        return {'t': 'toc', 'title': b.title}
    if isinstance(b, FigureList):
        return {'t': 'lof', 'title': b.title}
    if isinstance(b, References):
        return {'t': 'refs', 'entries': b.entries}
    raise TypeError(type(b))


def to_json(doc) -> dict:
    return {
        'title': doc.title, 'lang': doc.lang,
        'layout': getattr(doc, 'layout', 'plain'),
        'body_font': getattr(doc, 'body_font', 'Liberation Serif'),
        'heading_font': getattr(doc, 'heading_font', 'Liberation Serif'),
        'blocks': [_block(b) for b in doc.blocks],
    }


def emit(doc, d: Path, name: str = 'doc.json') -> None:
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text(json.dumps(to_json(doc), ensure_ascii=False), encoding='utf-8')
    shutil.copy(HERE / 'template.typ', d / 'template.typ')


def as_book(doc) -> BookDoc:
    return doc if isinstance(doc, BookDoc) else BookDoc(doc.title, doc.blocks, doc.lang,
                                                        layout='plain')
