#!/usr/bin/env python3
"""
Leitor Portátil de Livros — Desktop (EPUB · MOBI · PDF · TXT)
Aplicativo desktop portátil em arquivo único Python.
- Alta definição (High-DPI) nativa no Windows
- Parser MOBI/PalmDOC fiel à especificação (varint big-endian, EXTH, filepos e sumário clicável)
- Parser EPUB com suporte a árvore NCX/Nav e links internos clicáveis
- Parser PDF com descompressão FlateDecode + integração opcional com modo visual gráfico
"""

from __future__ import annotations

import ctypes
import json
import os
import posixpath
import re
import shutil
import struct
import subprocess
import sys
import tkinter as tk
from html.parser import HTMLParser
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
import zlib

# Ativar High-DPI Awareness no Windows para fontes nítidas (evita janela embaçada)
if sys.platform == "win32":
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass

try:
    import fitz  # type: ignore
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False


# ============================================================================
# 1. PALETAS DE TEMA EDITORIAIS
# ============================================================================
THEMES = {
    "light": {
        "label": "Claro",
        "bg_workspace": "#E9ECEF",
        "bg_toolbar": "#F8F9FA",
        "bg_sidebar": "#F1F3F5",
        "bg_page": "#FFFFFF",
        "bg_control": "#E2E6EA",
        "fg_primary": "#1A1D20",
        "fg_secondary": "#495057",
        "fg_muted": "#6C757D",
        "accent": "#1D4ED8",
        "border": "#CED4DA",
        "highlight": "#FEF08A",
    },
    "sepia": {
        "label": "Sépia",
        "bg_workspace": "#E4DAC6",
        "bg_toolbar": "#EDE4D1",
        "bg_sidebar": "#EAE0CC",
        "bg_page": "#F6EFE0",
        "bg_control": "#DDD1B8",
        "fg_primary": "#2C241D",
        "fg_secondary": "#5C4E41",
        "fg_muted": "#7D6E5F",
        "accent": "#7C3F1C",
        "border": "#CFC2A9",
        "highlight": "#FDE68A",
    },
    "dark": {
        "label": "Escuro",
        "bg_workspace": "#111315",
        "bg_toolbar": "#181A1D",
        "bg_sidebar": "#15171A",
        "bg_page": "#1C1F24",
        "bg_control": "#262A32",
        "fg_primary": "#D4D8DE",
        "fg_secondary": "#9AA2B1",
        "fg_muted": "#6E7681",
        "accent": "#58A6FF",
        "border": "#2B3038",
        "highlight": "#854D0E",
    },
}

FONTS = [
    "Georgia",
    "Palatino Linotype",
    "Segoe UI",
    "Verdana",
    "Times New Roman",
    "Consolas",
]


# ============================================================================
# 2. CONVERSOR HTML -> SEGMENTOS ESTRUTURADOS COM LINKS INTERNOS
# ============================================================================
class StructuredHTMLParser(HTMLParser):
    BLOCK_TAGS = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "tr"}
    SKIP_TAGS = {"script", "style", "head", "title", "meta", "link"}
    BLOCK_TAGS = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "tr", "section", "article"}
    SKIP_TAGS = {"script", "style", "head", "title"}
    VOID_TAGS = {"meta", "link", "br", "hr", "img", "input", "col", "area", "base", "param", "source", "wbr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        # Cada segmento: (texto, tupla_de_tags, link_target_opcional)
        self.segments: list[tuple[str, tuple[str, ...], str | None]] = []
        self.tag_stack: list[str] = []
        self.link_stack: list[str | None] = []
        self.skip_depth = 0
        self.first_heading = ""
        self._at_block_start = True

    def _active_styles(self) -> tuple[str, ...]:
        styles: list[str] = []
        for t in self.tag_stack:
            if t in ("h1", "h2", "h3", "h4"):
                styles.append(t)
            elif t in ("b", "strong"):
                styles.append("bold")
            elif t in ("i", "em"):
                styles.append("italic")
            elif t == "blockquote":
                styles.append("quote")
            elif t in ("code", "pre"):
                styles.append("mono")
        if self._active_link():
            styles.append("link")
        return tuple(styles)

    def _active_link(self) -> str | None:
        for lnk in reversed(self.link_stack):
            if lnk:
                return lnk
        return None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in self.SKIP_TAGS:
            self.skip_depth += 1
            return
        if self.skip_depth > 0:
            return

        if tag in ("br", "hr"):
            self.segments.append(("\n", (), None))
            self._at_block_start = True
            return

        if tag in self.VOID_TAGS:
            return

        if tag in self.BLOCK_TAGS:
            if self.segments and not self._at_block_start:
                self.segments.append(("\n\n", (), None))
            self._at_block_start = True
            if tag == "li":
                self.segments.append(("  • ", ("bold",), None))
                self._at_block_start = False

        if tag == "a":
            attr_dict = {k.lower(): (v or "") for k, v in attrs}
            fp = attr_dict.get("filepos", "").strip()
            href = attr_dict.get("href", "").strip()
            if fp and fp.isdigit():
                self.link_stack.append(f"filepos:{int(fp)}")
            elif href and not href.lower().startswith(("http:", "https:", "mailto:")):
                self.link_stack.append(f"href:{href}")
            else:
                self.link_stack.append(None)

        self.tag_stack.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in ("br", "hr") and self.skip_depth == 0:
            self.segments.append(("\n", (), None))
            self._at_block_start = True

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self.SKIP_TAGS:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if self.skip_depth > 0 or tag in self.VOID_TAGS:
            return

        if tag == "a" and self.link_stack:
            self.link_stack.pop()

        if tag in self.tag_stack:
            while self.tag_stack:
                popped = self.tag_stack.pop()
                if popped == tag:
                    break

        if tag in self.BLOCK_TAGS:
            if self.segments and not self._at_block_start:
                self.segments.append(("\n\n", (), None))
                self._at_block_start = True

    def handle_data(self, data: str) -> None:
        if self.skip_depth > 0:
            return
        if "pre" not in self.tag_stack:
            cleaned = re.sub(r"\s+", " ", data)
            if self._at_block_start:
                cleaned = cleaned.lstrip()
        else:
            cleaned = data

        if not cleaned:
            return

        styles = self._active_styles()
        if not self.first_heading and any(h in styles for h in ("h1", "h2", "h3")):
            self.first_heading = cleaned.strip()[:80]

        self.segments.append((cleaned, styles, self._active_link()))
        self._at_block_start = False

    def plain_text(self) -> str:
        return "".join(seg[0] for seg in self.segments).strip()


def html_to_structured(raw_html: str) -> tuple[list[tuple[str, tuple[str, ...], str | None]], str, str]:
    # Remover <head>, <script> e <style> previamente para evitar que tags auto-fechadas (<title/>) afetem o corpo
    cleaned_html = re.sub(r"<(head|script|style)\b[^>]*>[\s\S]*?</\1>", "", raw_html, flags=re.I)
    cleaned_html = re.sub(r"<(title|script|style|head)\b[^>]*/>", "", cleaned_html, flags=re.I)
    p = StructuredHTMLParser()
    p.feed(raw_html)
    p.feed(cleaned_html)
    p.close()
    return p.segments, p.plain_text(), p.first_heading


# ============================================================================
# 3. PARSER EPUB
# ============================================================================
def _resolve_zip_path(base_file: str, rel_href: str) -> str:
    clean_href = rel_href.split("#")[0]
    clean_href = rel_href.split("#")[0].strip().replace("\\", "/")
    if not clean_href:
        return base_file
    base_dir = posixpath.dirname(base_file)
    if clean_href.startswith("/"):
        return clean_href.lstrip("/")
    base_dir = posixpath.dirname(base_file.replace("\\", "/"))
    joined = posixpath.normpath(posixpath.join(base_dir, clean_href))
    return joined.lstrip("/")


def _decode_epub_bytes(b: bytes) -> str:
    if b.startswith(b"\xfe\xff"):
        return b[2:].decode("utf-16-be", errors="replace")
    if b.startswith(b"\xff\xfe"):
        return b[2:].decode("utf-16-le", errors="replace")
    if b.startswith(b"\xef\xbb\xbf"):
        b = b[3:]
    head = b[:250].decode("latin1", errors="replace")
    if re.search(r'encoding=["\'](iso-8859-1|latin1|windows-1252|cp1252)["\']', head, flags=re.I):
        return b.decode("cp1252", errors="replace")
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return b.decode("cp1252", errors="replace")


def _parse_xml_tolerant(raw_bytes: bytes) -> ET.Element:
    txt = _decode_epub_bytes(raw_bytes).lstrip("\ufeff").strip()
    txt = (
        txt.replace("&nbsp;", "&#160;")
        .replace("&mdash;", "&#8212;")
        .replace("&ndash;", "&#8211;")
        .replace("&copy;", "&#169;")
        .replace("&reg;", "&#174;")
    )
    txt = re.sub(r"&(?!#[0-9]+;|#x[0-9a-fA-F]+;|[a-zA-Z0-9_]+;)", "&amp;", txt)
    return ET.fromstring(txt.encode("utf-8"))


def parse_epub_file(file_path: str) -> dict:
    with zipfile.ZipFile(file_path, "r") as zf:
        raw_names = zf.namelist()
        exact_map: dict[str, str] = {}
        lower_map: dict[str, str] = {}
        base_map: dict[str, str] = {}

        for n in raw_names:
            norm = n.replace("\\", "/").lstrip("/")
            exact_map[norm] = n
            lower_map[norm.lower()] = n
            unq = urllib.parse.unquote(norm)
            exact_map.setdefault(unq, n)
            lower_map.setdefault(unq.lower(), n)
            bname = posixpath.basename(unq).lower()
            if bname:
                base_map.setdefault(bname, n)

        def read_entry(entry_path: str) -> bytes | None:
            if not entry_path:
                return None
            norm = entry_path.replace("\\", "/").lstrip("/")
            unq = urllib.parse.unquote(norm)
            for cand in (norm, unq):
                if cand in exact_map:
                    return zf.read(exact_map[cand])
                if cand.lower() in lower_map:
                    return zf.read(lower_map[cand.lower()])
            bname = posixpath.basename(unq).lower()
            for k_low, orig_name in lower_map.items():
                if k_low.endswith("/" + unq.lower()):
                    return zf.read(orig_name)
            if bname in base_map:
                return zf.read(base_map[bname])
            return None

        opf_path = None
        container_bytes = read_entry("META-INF/container.xml")
        if container_bytes:
            try:
                c_root = _parse_xml_tolerant(container_bytes)
                for el in c_root.iter():
                    if el.tag.lower().endswith("rootfile") and el.attrib.get("full-path"):
                        opf_path = el.attrib["full-path"]
                        break
            except Exception:
                pass

        if not opf_path:
            for n in raw_names:
                if n.lower().endswith(".opf"):
                    opf_path = n
                    break
        if not opf_path:
            raise ValueError("EPUB inválido: arquivo .opf não localizado.")

        opf_bytes = read_entry(opf_path)
        if not opf_bytes:
            raise ValueError("EPUB inválido: arquivo OPF ilegível.")

        opf_root = _parse_xml_tolerant(opf_bytes)
        title = Path(file_path).stem
        author = "Autor Desconhecido"

        for el in opf_root.iter():
            tname = el.tag.split("}")[-1].split(":")[-1].lower()
            if tname == "title" and el.text and el.text.strip():
                title = el.text.strip()
            elif tname == "creator" and el.text and el.text.strip():
                author = el.text.strip()

        manifest: dict[str, dict] = {}
        manifest_lower: dict[str, dict] = {}
        spine_ids: list[str] = []
        toc_id: str | None = None

        for el in opf_root.iter():
            tname = el.tag.split("}")[-1].split(":")[-1].lower()
            if tname == "item":
                iid = el.attrib.get("id")
                href = el.attrib.get("href")
                mtype = (el.attrib.get("media-type") or "").lower()
                props = (el.attrib.get("properties") or "").lower()
                if iid and href:
                    info = {"id": iid, "href": href, "type": mtype, "props": props}
                    manifest[iid] = info
                    manifest_lower[iid.lower()] = info
            elif tname == "spine":
                toc_id = el.attrib.get("toc")
            elif tname == "itemref":
                idref = el.attrib.get("idref")
                if idref:
                    spine_ids.append(idref)

        if not toc_id:
            for iid, info in manifest.items():
                if "dtbncx" in info["type"] or info["href"].lower().endswith(".ncx"):
                    toc_id = iid
                    break

        toc_entries: list[tuple[str, str]] = []
        toc_labels: dict[str, str] = {}
        ncx_item = manifest.get(toc_id or "") or manifest_lower.get((toc_id or "").lower())
        if ncx_item:
            ncx_path = _resolve_zip_path(opf_path, ncx_item["href"])
            ncx_bytes = read_entry(ncx_path)
            if ncx_bytes:
                try:
                    ncx_root = _parse_xml_tolerant(ncx_bytes)
                    for np in ncx_root.iter():
                        if np.tag.lower().endswith("navpoint"):
                            lbl = None
                            src = None
                            for ch in np.iter():
                                cname = ch.tag.split("}")[-1].split(":")[-1].lower()
                                if cname == "text" and ch.text and ch.text.strip():
                                    lbl = re.sub(r"\s+", " ", ch.text).strip()
                                elif cname == "content" and ch.attrib.get("src"):
                                    src = ch.attrib["src"]
                            if lbl and src:
                                target = urllib.parse.unquote(_resolve_zip_path(ncx_path, src))
                                toc_labels.setdefault(target.lower(), lbl)
                                toc_labels.setdefault(posixpath.basename(target).lower(), lbl)
                                toc_entries.append((lbl, target))
                except Exception:
                    pass

        if not toc_entries:
            for info in manifest.values():
                if "nav" in info["props"] or "nav" in info["href"].lower():
                    nav_path = _resolve_zip_path(opf_path, info["href"])
                    nav_bytes = read_entry(nav_path)
                    if nav_bytes:
                        nav_html = _decode_epub_bytes(nav_bytes)
                        for m in re.finditer(r'<a\b[^>]*?\bhref=["\']([^"\']+)["\'][^>]*>([\s\S]{1,200}?)</a>', nav_html, flags=re.I):
                            raw_href, raw_lbl = m.group(1), m.group(2)
                            if raw_href.lower().startswith(("http:", "https:", "mailto:")):
                                continue
                            lbl = re.sub(r"<[^>]+>", "", raw_lbl)
                            lbl = re.sub(r"\s+", " ", lbl).strip()
                            if lbl:
                                target = urllib.parse.unquote(_resolve_zip_path(nav_path, raw_href))
                                toc_labels.setdefault(target.lower(), lbl)
                                toc_entries.append((lbl, target))
                        if toc_entries:
                            break

        spine_hrefs: list[str] = []
        for idref in spine_ids:
            info = manifest.get(idref) or manifest_lower.get(idref.lower())
            if info:
                spine_hrefs.append(info["href"])

        if not spine_hrefs:
            for info in manifest.values():
                if "html" in info["type"] or re.search(r"\.(x?html?|htm|xml)$", info["href"], flags=re.I):
                    if not info["href"].lower().endswith(".ncx"):
                        spine_hrefs.append(info["href"])

        sections: list[dict] = []
        path_to_idx: dict[str, int] = {}

        for href in spine_hrefs:
            sec_path = _resolve_zip_path(opf_path, href)
            raw_bytes = read_entry(sec_path)
            if not raw_bytes:
                continue
            raw_html = _decode_epub_bytes(raw_bytes)
            segments, plain, heading = html_to_structured(raw_html)
            if not plain:
                if re.search(r"<(img|image|svg)\b", raw_html, flags=re.I):
                    segments = [("[Capa / Ilustração]\n", ("italic",), None)]
                    plain = "[Capa / Ilustração]"
                else:
                    continue

            sec_idx = len(sections)
            unq_sec = urllib.parse.unquote(sec_path)
            for key_cand in (sec_path, sec_path.lower(), unq_sec, unq_sec.lower(), posixpath.basename(unq_sec).lower()):
                path_to_idx.setdefault(key_cand, sec_idx)

            sec_title = (
                toc_labels.get(unq_sec.lower())
                or toc_labels.get(posixpath.basename(unq_sec).lower())
                or heading
                or f"Capítulo {sec_idx + 1}"
            )
            sections.append({
                "title": sec_title[:80],
                "segments": segments,
                "text": plain,
                "path": sec_path,
            })

        if not sections:
            raise ValueError("Nenhum capítulo de texto encontrado no EPUB.")

        toc: list[dict] = []
        for lbl, target in toc_entries:
            idx = (
                path_to_idx.get(target)
                if target in path_to_idx
                else path_to_idx.get(target.lower(), path_to_idx.get(posixpath.basename(target).lower()))
            )
            if idx is not None and not any(t["sectionIndex"] == idx and t["label"] == lbl for t in toc):
                toc.append({"label": lbl, "sectionIndex": idx})
        if not toc:
            toc = [{"label": s["title"], "sectionIndex": i} for i, s in enumerate(sections)]

        return {
            "title": title,
            "author": author,
            "format": "EPUB",
            "sections": sections,
            "toc": toc,
            "path_to_idx": path_to_idx,
        }


# ============================================================================
# 4. PARSER MOBI / PALMDOC CORRIGIDO (VARINT BIG-ENDIAN + FILEPOS + CAPÍTULOS)
# ============================================================================
def _decompress_palmdoc(data: bytes) -> bytes:
    out = bytearray()
    i = 0
    n = len(data)
    while i < n:
        b = data[i]
        i += 1
        if b == 0x00:
            out.append(0x00)
        elif 0x01 <= b <= 0x08:
            out.extend(data[i : i + b])
            i += b
        elif 0x09 <= b <= 0x7F:
            out.append(b)
        elif 0x80 <= b <= 0xBF:
            if i >= n:
                break
            b2 = data[i]
            i += 1
            pair = ((b << 8) | b2) & 0x3FFF
            dist = pair >> 3
            length = (pair & 0x07) + 3
            if dist < 1:
                continue
            for _ in range(length):
                pos = len(out) - dist
                out.append(out[pos] if pos >= 0 else 32)
        else:
            out.append(0x20)
            out.append(b ^ 0x80)
    return bytes(out)


def _get_size_of_trailing_data_entry(data: bytes, end: int) -> int:
    num = 0
    start = max(0, end - 4)
    for i in range(start, end):
        b = data[i]
        if b & 0x80:
            num = 0
        num = (num << 7) | (b & 0x7F)
    return num


def _trim_mobi_trailing_bytes(record: bytes, extra_flags: int) -> bytes:
    if not extra_flags:
        return record
    end = len(record)
    flags = extra_flags >> 1
    while flags:
        if flags & 1:
            size = _get_size_of_trailing_data_entry(record, end)
            if 0 < size <= end:
                end -= size
        flags >>= 1
    if (extra_flags & 1) and end > 0:
        overlap = (record[end - 1] & 0x03) + 1
        if overlap <= end:
            end -= overlap
    return record[:end]


def parse_mobi_file(file_path: str) -> dict:
    raw = Path(file_path).read_bytes()
    if len(raw) < 78:
        raise ValueError("Arquivo MOBI inválido ou corrompido.")

    pdb_name = raw[:32].split(b"\x00", 1)[0].decode("latin1", errors="replace").strip()
    num_records = struct.unpack(">H", raw[76:78])[0]
    if num_records < 2:
        raise ValueError("Arquivo MOBI sem registros de texto.")

    offsets: list[int] = []
    for i in range(num_records):
        offsets.append(struct.unpack(">I", raw[78 + i * 8 : 82 + i * 8])[0])
    offsets.append(len(raw))

    def get_record(idx: int) -> bytes:
        s, e = offsets[idx], offsets[idx + 1]
        if s >= len(raw) or e <= s:
            return b""
        return raw[s : min(len(raw), e)]

    def parse_header_at(rec_idx: int) -> dict | None:
        r_bytes = get_record(rec_idx)
        if len(r_bytes) < 16:
            return None
        comp, _, _, txt_rec_count, _, enc_type, _ = struct.unpack(">HHIHHHH", r_bytes[:16])
        enc = "cp1252"
        bk_title = pdb_name or Path(file_path).stem
        bk_author = "Autor Desconhecido"
        ext_flags = 0

        if len(r_bytes) >= 36 and r_bytes[16:20] == b"MOBI":
            mobi_header_len = struct.unpack(">I", r_bytes[20:24])[0]
            codepage = struct.unpack(">I", r_bytes[28:32])[0]
            if codepage == 65001:
                enc = "utf-8"

            if len(r_bytes) >= 108:
                fn_offset, fn_len = struct.unpack(">II", r_bytes[84:92])
                fmt_version = struct.unpack(">I", r_bytes[104:108])[0]
                if fn_offset and fn_len and fn_offset + fn_len <= len(r_bytes):
                    t_str = r_bytes[fn_offset : fn_offset + fn_len].decode(enc, errors="replace").strip()
                    if t_str:
                        bk_title = t_str
                if mobi_header_len >= 228 and len(r_bytes) >= 244 and fmt_version >= 5:
                    raw_flags = struct.unpack(">H", r_bytes[242:244])[0]
                    if raw_flags != 0xFFFF:
                        ext_flags = raw_flags

            exth_flags = struct.unpack(">I", r_bytes[128:132])[0] if len(r_bytes) >= 132 else 0
            exth_off = 16 + mobi_header_len
            if (exth_flags & 0x40) and len(r_bytes) >= exth_off + 12 and r_bytes[exth_off : exth_off + 4] == b"EXTH":
                exth_count = struct.unpack(">I", r_bytes[exth_off + 8 : exth_off + 12])[0]
                p = exth_off + 12
                authors: list[str] = []
                for _ in range(exth_count):
                    if p + 8 > len(r_bytes):
                        break
                    rtype, rlen = struct.unpack(">II", r_bytes[p : p + 8])
                    if rlen < 8 or p + rlen > len(r_bytes):
                        break
                    val = r_bytes[p + 8 : p + rlen].decode(enc, errors="replace").strip()
                    if rtype == 100 and val:
                        authors.append(val)
                    elif rtype == 503 and val:
                        bk_title = val
                    p += rlen
                if authors:
                    bk_author = ", ".join(authors)

        return {
            "base_rec": rec_idx,
            "compression": comp,
            "text_rec_count": txt_rec_count,
            "encryption_type": enc_type,
            "encoding": enc,
            "title": bk_title,
            "author": bk_author,
            "extra_flags": ext_flags,
        }

    hdr = parse_header_at(0)
    if not hdr:
        raise ValueError("Cabeçalho MOBI/AZW3 inválido.")

    if hdr["text_rec_count"] <= 2:
        for r in range(1, num_records - 1):
            if get_record(r) == b"BOUNDARY":
                kf8_hdr = parse_header_at(r + 1)
                if kf8_hdr and kf8_hdr["text_rec_count"] > hdr["text_rec_count"]:
                    hdr = kf8_hdr
                    break

    if hdr["encryption_type"] != 0:
        raise ValueError("Este livro possui proteção DRM.")
    if hdr["compression"] not in (1, 2):
        raise ValueError("Compressão proprietária HUFF/CDIC não suportada.")

    base_rec = hdr["base_rec"]
    compression = hdr["compression"]
    text_rec_count = hdr["text_rec_count"]
    encoding = hdr["encoding"]
    title = hdr["title"]
    author = hdr["author"]
    extra_flags = hdr["extra_flags"]

    max_rec = min(base_rec + text_rec_count, num_records - 1)
    chunks: list[bytes] = []
    for r in range(base_rec + 1, max_rec + 1):
        rec_bytes = _trim_mobi_trailing_bytes(get_record(r), extra_flags)
        decomp = _decompress_palmdoc(rec_bytes) if compression == 2 else rec_bytes
        chunks.append(decomp)

    raw_decompressed = b"".join(chunks)

    # Em arquivos .azw3 (KF8), verificar tabela FDST para isolar exatamente o Flow 0 (HTML completo do livro)
    for r in range(max_rec + 1, num_records):
        b = get_record(r)
        if len(b) >= 20 and b[:4] == b"FDST":
            sec_off, num_flows = struct.unpack(">II", b[4:12])
            if num_flows >= 1 and sec_off + 8 <= len(b):
                f0_start, f0_end = struct.unpack(">II", b[sec_off : sec_off + 8])
                if f0_start == 0 and 0 < f0_end <= len(raw_decompressed):
                    raw_decompressed = raw_decompressed[:f0_end]
            break

    full_html = raw_decompressed.decode(encoding, errors="replace")

    # Extrair Sumário (links <a filepos="...">)
    filepos_toc: list[dict] = []
    for m in re.finditer(r'<a\b[^>]{1,240}?\bfilepos=["\']?0*(\d+)["\']?[^>]{0,240}?>([\s\S]{1,300}?)</a>', full_html, flags=re.I):
        fp = int(m.group(1))
        lbl = re.sub(r"<[^>]+>", "", m.group(2))
        lbl = re.sub(r"\s+", " ", lbl).strip()
        if 1 < len(lbl) < 120 and not any(abs(x["filepos"] - fp) < 10 for x in filepos_toc):
            filepos_toc.append({"label": lbl, "filepos": fp})

    # Pontos de divisão (<mbp:pagebreak>, fronteiras </html>...<?xml...><html do AZW3, <h1, <h2, e filepos do Sumário)
    split_points = {0}
    break_pat = r"<mbp:pagebreak\s*/?>|</html>\s*(?:<\?xml[^>]*>\s*)?(?:<!doctype[^>]*>\s*)?<html\b|<(?:div|p|br)\b[^>]{0,160}?\b(?:class=[\"'][^\"']*pagebreak[^\"']*[\"']|id=[\"']calibre_pb_\d+[\"'])[^>]{0,160}?>|<h[12]\b"
    for m in re.finditer(break_pat, full_html, flags=re.I):
        matched = m.group(0).lower()
        split_pos = m.start()
        if matched.startswith("</html>"):
            idx_html = matched.rfind("<html")
            if idx_html != -1:
                split_pos = m.start() + idx_html
        if split_pos > 16:
            split_points.add(split_pos)

    for item in filepos_toc:
        fp = item["filepos"]
        if 16 < fp < len(full_html):
            if not any(abs(ex - fp) <= 48 for ex in split_points):
                split_points.add(fp)

    sorted_splits = sorted(split_points)
    final_ranges: list[tuple[int, int]] = []
    MAX_LEN = 350000 if len(sorted_splits) >= 4 else 90000
    for i, start in enumerate(sorted_splits):
        limit = sorted_splits[i + 1] if i + 1 < len(sorted_splits) else len(full_html)
        cur = start
        while limit - cur > MAX_LEN:
            step = int(MAX_LEN * 0.8)
            cut = full_html.find("<p", cur + step, limit)
            if cut == -1:
                cut = full_html.find("<div", cur + step, limit)
            if cut == -1:
                cut = full_html.find("<br", cur + step, limit)
            if cut == -1 or cut <= cur:
                cut = cur + MAX_LEN
            final_ranges.append((cur, cut))
            cur = cut
        if limit > cur:
            final_ranges.append((cur, limit))

    sections: list[dict] = []
    for c_start, c_end in final_ranges:
        part_html = full_html[c_start:c_end]
        segments, plain, heading = html_to_structured(part_html)
        if not plain:
            continue

        sec_idx = len(sections)
        toc_match = next((t["label"] for t in filepos_toc if abs(t["filepos"] - c_start) <= 32), None)
        sec_title = toc_match or heading or f"Seção {sec_idx + 1}"
        if len(sec_title) > 75:
            sec_title = sec_title[:72] + "…"

        sections.append({
            "title": sec_title,
            "segments": segments,
            "text": plain,
            "fileposStart": c_start,
            "fileposEnd": c_end,
        })

    def _find_sec_for_filepos(fp: int) -> int:
        for i, s in enumerate(sections):
            if abs(s["fileposStart"] - fp) <= 32:
                return i
        for i, s in enumerate(sections):
            if s["fileposStart"] <= fp < s["fileposEnd"]:
                return i
        return -1

    toc: list[dict] = []
    for item in filepos_toc:
        idx = _find_sec_for_filepos(item["filepos"])
        if idx != -1 and not any(t["sectionIndex"] == idx and t["label"] == item["label"] for t in toc):
            toc.append({"label": item["label"], "sectionIndex": idx})

    if not toc:
        toc = [{"label": s["title"], "sectionIndex": i} for i, s in enumerate(sections)]

    return {
        "title": title,
        "author": author,
        "format": "MOBI",
        "sections": sections,
        "toc": toc,
        "path_to_idx": {},
    }


# ============================================================================
# 5. PARSER PDF
# ============================================================================
def _decode_pdf_string(raw_str: str) -> str:
    out: list[str] = []
    i = 0
    n = len(raw_str)
    while i < n:
        ch = raw_str[i]
        if ch != "\\":
            out.append(ch)
            i += 1
            continue
        i += 1
        if i >= n:
            break
        esc = raw_str[i]
        i += 1
        if esc == "n":
            out.append("\n")
        elif esc == "r":
            out.append("\r")
        elif esc == "t":
            out.append("\t")
        elif esc in ("(", ")", "\\"):
            out.append(esc)
        elif esc.isdigit():
            oct_d = esc
            for _ in range(2):
                if i < n and raw_str[i].isdigit():
                    oct_d += raw_str[i]
                    i += 1
                else:
                    break
            out.append(chr(int(oct_d, 8)))
        else:
            out.append(esc)
    res = "".join(out)
    if res.startswith("\xfe\xff"):
        return res[2:].encode("latin1", errors="replace").decode("utf-16-be", errors="replace")
    return res


def _parse_pdf_cmap(cmap_text: str, cmap: dict[int, str]) -> None:
    for m in re.finditer(r"beginbfchar(.*?)endbfchar", cmap_text, flags=re.DOTALL):
        pairs = re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", m.group(1))
        for src_hex, dst_hex in pairs:
            try:
                src_code = int(src_hex, 16)
                dst_bytes = bytes.fromhex(dst_hex if len(dst_hex) % 2 == 0 else "0" + dst_hex)
                cmap[src_code] = dst_bytes.decode("utf-16-be" if len(dst_bytes) >= 2 else "latin1", errors="replace")
            except ValueError:
                pass
    for m in re.finditer(r"beginbfrange(.*?)endbfrange", cmap_text, flags=re.DOTALL):
        for r_m in re.finditer(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", m.group(1)):
            try:
                start_c = int(r_m.group(1), 16)
                end_c = int(r_m.group(2), 16)
                dst_c = int(r_m.group(3), 16)
                if end_c - start_c < 1024:
                    for offset in range(end_c - start_c + 1):
                        code_pt = dst_c + offset
                        if 0 <= code_pt <= 0x10FFFF:
                            cmap[start_c + offset] = chr(code_pt)
            except ValueError:
                pass


def _decode_pdf_hex(hx: str, cmap: dict[int, str] | None = None) -> str:
    hx = re.sub(r"\s+", "", hx)
    if not hx:
        return ""
    if len(hx) % 2 == 1:
        hx += "0"
    try:
        b = bytes.fromhex(hx)
    except ValueError:
        return ""
    if b.startswith(b"\xfe\xff"):
        return b[2:].decode("utf-16-be", errors="replace")
    if cmap:
        if len(b) % 2 == 0:
            two_byte_hits = sum(1 for i in range(0, len(b), 2) if int.from_bytes(b[i:i+2], "big") in cmap)
            if two_byte_hits > 0:
                out = []
                for i in range(0, len(b), 2):
                    code = int.from_bytes(b[i:i+2], "big")
                    out.append(cmap.get(code, chr(code) if 32 <= code <= 255 else ""))
                return "".join(out)
        one_byte_hits = sum(1 for byte in b if byte in cmap)
        if one_byte_hits > 0:
            return "".join(cmap.get(byte, chr(byte) if 32 <= byte <= 255 else "") for byte in b)
    return b.decode("cp1252", errors="replace")


def _extract_pdf_stream_text(stream_text: str, cmap: dict[int, str] | None = None) -> str:
    lines: list[str] = []
    cur: list[str] = []
    blocks = re.findall(r"BT\b(.*?)ET\b", stream_text, flags=re.DOTALL) or [stream_text]
    tok_re = re.compile(
        r"(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\[(?:\\.|[^\]])*\]|\b(?:Tj|TJ|Td|TD|T\*|'|\"|ET)\b)"
    )
    last_lit = ""
    for blk in blocks:
        for tok in tok_re.findall(blk):
            if tok.startswith("(") and tok.endswith(")"):
                last_lit = _decode_pdf_string(tok[1:-1])
            elif tok.startswith("<") and tok.endswith(">"):
                last_lit = _decode_pdf_hex(tok[1:-1], cmap)
            elif tok.startswith("[") and tok.endswith("]"):
                parts: list[str] = []
                for sub in re.findall(r"\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|-?\d+(?:\.\d+)?", tok[1:-1]):
                    if sub.startswith("("):
                        parts.append(_decode_pdf_string(sub[1:-1]))
                    elif sub.startswith("<"):
                        parts.append(_decode_pdf_hex(sub[1:-1], cmap))
                    else:
                        try:
                            if float(sub) < -120:
                                parts.append(" ")
                        except ValueError:
                            pass
                last_lit = "".join(parts)
            elif tok in ("Tj", "TJ"):
                if last_lit:
                    cur.append(last_lit)
                    last_lit = ""
            elif tok in ("'", '"', "T*", "TD", "Td"):
                if cur:
                    lines.append("".join(cur).strip())
                    cur = []
                if tok in ("'", '"') and last_lit:
                    cur.append(last_lit)
                    last_lit = ""
        if cur:
            lines.append("".join(cur).strip())
            cur = []
    return "\n".join(ln for ln in lines if ln)


def parse_pdf_file(file_path: str) -> dict:
    title = Path(file_path).stem
    author = "Documento PDF"

    if HAS_PYMUPDF:
        doc = fitz.open(file_path)
        meta = doc.metadata or {}
        if meta.get("title"):
            title = meta["title"].strip()
        if meta.get("author"):
            author = meta["author"].strip()
        sections = []
        for idx, page in enumerate(doc):
            txt = page.get_text("text").strip()
            h = f"Página {idx + 1}"
            sections.append({
                "title": h,
                "segments": [(f"{h}\n\n", ("h2",), None), (txt or "[Página gráfica]", (), None)],
                "text": txt,
            })
        doc.close()
        if sections:
            return {
                "title": title,
                "author": author,
                "format": "PDF",
                "sections": sections,
                "toc": [{"label": s["title"], "sectionIndex": i} for i, s in enumerate(sections)],
                "path_to_idx": {},
            }

    raw = Path(file_path).read_bytes()
    decompressed_streams: list[str] = []
    cmap: dict[int, str] = {}

    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", raw, flags=re.DOTALL):
        s_bytes = m.group(1)
        header_window = raw[max(0, m.start() - 512):m.start()]
        if b"/FlateDecode" in header_window or b"/Fl" in header_window:
            decomp = None
            for wb in (zlib.MAX_WBITS, -zlib.MAX_WBITS):
                try:
                    decomp = zlib.decompress(s_bytes, wb)
                    break
                except zlib.error:
                    continue
            if decomp is None:
                continue
        else:
            decomp = s_bytes

        latin = decomp.decode("latin1", errors="replace")
        if "beginbfchar" in latin or "beginbfrange" in latin:
            _parse_pdf_cmap(latin, cmap)
        elif "BT" in latin or "Tj" in latin or "TJ" in latin:
            decompressed_streams.append(latin)

    sections = []
    for latin in decompressed_streams:
        extracted = _extract_pdf_stream_text(latin, cmap).strip()
        if extracted:
            pnum = len(sections) + 1
            h = f"Página {pnum}"
            sections.append({
                "title": h,
                "segments": [(f"{h}\n\n", ("h2",), None), (extracted, (), None)],
                "text": extracted,
            })

    if not sections:
        sections.append({
            "title": "Página 1",
            "segments": [
                ("Documento PDF Gráﬁco\n\n", ("h2",), None),
                ("Clique em 'Modo Visual (PDF/Web)' na barra superior para renderizar as páginas originais deste PDF com imagens e fontes embutidas.", (), None),
            ],
            "text": "",
        })

    return {
        "title": title,
        "author": author,
        "format": "PDF",
        "sections": sections,
        "toc": [{"label": s["title"], "sectionIndex": i} for i, s in enumerate(sections)],
        "path_to_idx": {},
    }


# ============================================================================
# 6. INTERFACE DESKTOP TKINTER EDITORIAL
# ============================================================================
class BookReaderApp(tk.Tk):
    def __init__(self, initial_file: str | None = None) -> None:
        super().__init__()
        self.title("Leitor de Livros — EPUB · MOBI · PDF")
        self.geometry("1160x800")
        self.minsize(780, 520)

        self.base_dir = Path(__file__).resolve().parent
        self.state_path = self.base_dir / "reader_state.json"
        self.state_data = self._read_state()

        self.theme_key: str = self.state_data.get("theme", "sepia")
        if self.theme_key not in THEMES:
            self.theme_key = "sepia"
        self.font_family: str = self.state_data.get("font_family", "Georgia")
        self.font_size: int = int(self.state_data.get("font_size", 14))
        self.line_spacing: int = int(self.state_data.get("line_spacing", 7))
        self.page_margin: int = int(self.state_data.get("page_margin", 64))

        self.book_path: str | None = None
        self.book_title: str = "Nenhum livro aberto"
        self.book_author: str = ""
        self.book_format: str = ""
        self.sections: list[dict] = []
        self.toc: list[dict] = []
        self.path_to_idx: dict[str, int] = {}
        self.current_index: int = 0
        self.sidebar_open: bool = True

        self.style = ttk.Style(self)
        try:
            self.style.theme_use("clam")
        except Exception:
            pass

        self._build_layout()
        self.apply_theme()

        self.bind("<Left>", lambda e: self._key_step(e, -1))
        self.bind("<Right>", lambda e: self._key_step(e, 1))
        self.bind("<Control-o>", lambda e: self.prompt_open_file())
        self.bind("<Control-plus>", lambda e: self.adjust_font(1))
        self.bind("<Control-equal>", lambda e: self.adjust_font(1))
        self.bind("<Control-minus>", lambda e: self.adjust_font(-1))

        if initial_file and Path(initial_file).is_file():
            self.open_book(initial_file)
        else:
            self._render_empty_screen()

    def _read_state(self) -> dict:
        if self.state_path.is_file():
            try:
                return json.loads(self.state_path.read_text(encoding="utf-8"))
            except Exception:
                return {}
        return {}

    def _write_state(self) -> None:
        self.state_data["theme"] = self.theme_key
        self.state_data["font_family"] = self.font_family
        self.state_data["font_size"] = self.font_size
        self.state_data["line_spacing"] = self.line_spacing
        self.state_data["page_margin"] = self.page_margin
        if self.book_path and self.sections:
            books = self.state_data.setdefault("books", {})
            books[self.book_path] = {
                "title": self.book_title,
                "author": self.book_author,
                "format": self.book_format,
                "index": self.current_index,
                "total": len(self.sections),
            }
        try:
            self.state_path.write_text(json.dumps(self.state_data, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass

    def _build_layout(self) -> None:
        # Barra Superior
        self.toolbar = tk.Frame(self, height=44, bd=0)
        self.toolbar.pack(side=tk.TOP, fill=tk.X)
        self.toolbar_border = tk.Frame(self, height=1, bd=0)
        self.toolbar_border.pack(side=tk.TOP, fill=tk.X)

        self.tb_left = tk.Frame(self.toolbar)
        self.tb_left.pack(side=tk.LEFT, padx=8, pady=6)

        self.btn_toggle_toc = tk.Button(
            self.tb_left, text="Sumário", command=self.toggle_sidebar, relief=tk.FLAT, bd=0, padx=10, pady=4, cursor="hand2"
        )
        self.btn_toggle_toc.pack(side=tk.LEFT, padx=(0, 4))

        self.btn_open = tk.Button(
            self.tb_left, text="Abrir Arquivo...", command=self.prompt_open_file, relief=tk.FLAT, bd=0, padx=12, pady=4, cursor="hand2"
        )
        self.btn_open.pack(side=tk.LEFT, padx=(0, 8))

        self.btn_prev = tk.Button(
            self.tb_left, text="‹", command=lambda: self.step_section(-1), relief=tk.FLAT, bd=0, padx=8, pady=2, cursor="hand2"
        )
        self.btn_prev.pack(side=tk.LEFT, padx=2)

        self.entry_sec = tk.Entry(self.tb_left, width=5, justify="center", relief=tk.SOLID, bd=1)
        self.entry_sec.pack(side=tk.LEFT, padx=2, ipady=2)
        self.entry_sec.insert(0, "0")
        self.entry_sec.bind("<Return>", self._on_jump_entry)

        self.lbl_total_sec = tk.Label(self.tb_left, text="/ 0")
        self.lbl_total_sec.pack(side=tk.LEFT, padx=(2, 4))

        self.btn_next = tk.Button(
            self.tb_left, text="›", command=lambda: self.step_section(1), relief=tk.FLAT, bd=0, padx=8, pady=2, cursor="hand2"
        )
        self.btn_next.pack(side=tk.LEFT, padx=2)

        # Título Central
        self.lbl_doc_title = tk.Label(self.toolbar, text="Nenhum livro aberto", font=("Segoe UI", 10, "bold"))
        self.lbl_doc_title.pack(side=tk.LEFT, expand=True, padx=10)

        # Controles à Direita
        self.tb_right = tk.Frame(self.toolbar)
        self.tb_right.pack(side=tk.RIGHT, padx=8, pady=6)

        self.btn_visual = tk.Button(
            self.tb_right,
            text="Modo Visual (HTML/PDF)",
            command=self.launch_visual_window,
            relief=tk.FLAT,
            bd=0,
            padx=9,
            pady=4,
            cursor="hand2",
        )
        self.btn_visual.pack(side=tk.LEFT, padx=(0, 8))

        self.theme_buttons: dict[str, tk.Button] = {}
        for k in ("light", "sepia", "dark"):
            b = tk.Button(
                self.tb_right,
                text=THEMES[k]["label"],
                command=lambda key=k: self.set_theme(key),
                relief=tk.FLAT,
                bd=0,
                padx=8,
                pady=4,
                cursor="hand2",
            )
            b.pack(side=tk.LEFT, padx=1)
            self.theme_buttons[k] = b

        self.font_var = tk.StringVar(value=self.font_family)
        self.combo_font = ttk.Combobox(
            self.tb_right, textvariable=self.font_var, values=FONTS, state="readonly", width=15
        )
        self.combo_font.pack(side=tk.LEFT, padx=6)
        self.combo_font.bind("<<ComboboxSelected>>", self._on_font_change)

        self.btn_f_dec = tk.Button(
            self.tb_right, text="A−", command=lambda: self.adjust_font(-1), relief=tk.FLAT, bd=0, padx=7, pady=4, cursor="hand2"
        )
        self.btn_f_dec.pack(side=tk.LEFT, padx=1)

        self.lbl_f_size = tk.Label(self.tb_right, text=f"{self.font_size}pt", width=4)
        self.lbl_f_size.pack(side=tk.LEFT)

        self.btn_f_inc = tk.Button(
            self.tb_right, text="A+", command=lambda: self.adjust_font(1), relief=tk.FLAT, bd=0, padx=7, pady=4, cursor="hand2"
        )
        self.btn_f_inc.pack(side=tk.LEFT, padx=1)

        # Corpo Principal
        self.body = tk.Frame(self)
        self.body.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        # Barra Lateral
        self.sidebar = tk.Frame(self.body, width=265)
        self.sidebar.pack(side=tk.LEFT, fill=tk.Y)
        self.sidebar.pack_propagate(False)

        self.sidebar_border = tk.Frame(self.body, width=1)
        self.sidebar_border.pack(side=tk.LEFT, fill=tk.Y)

        self.search_row = tk.Frame(self.sidebar)
        self.search_row.pack(side=tk.TOP, fill=tk.X, padx=8, pady=8)

        self.entry_search = tk.Entry(self.search_row, relief=tk.SOLID, bd=1)
        self.entry_search.pack(side=tk.LEFT, fill=tk.X, expand=True, ipady=3, padx=(0, 4))
        self.entry_search.bind("<Return>", lambda e: self.find_next())

        self.btn_search = tk.Button(
            self.search_row, text="Buscar", command=self.find_next, relief=tk.FLAT, bd=0, padx=8, pady=3, cursor="hand2"
        )
        self.btn_search.pack(side=tk.RIGHT)

        self.lbl_toc_caption = tk.Label(self.sidebar, text="SUMÁRIO DO LIVRO", font=("Segoe UI", 8, "bold"), anchor="w")
        self.lbl_toc_caption.pack(side=tk.TOP, fill=tk.X, padx=10, pady=(2, 4))

        self.toc_frame = tk.Frame(self.sidebar)
        self.toc_frame.pack(side=tk.TOP, fill=tk.BOTH, expand=True, padx=8, pady=(0, 8))

        self.toc_scroll = ttk.Scrollbar(self.toc_frame, orient=tk.VERTICAL)
        self.toc_list = tk.Listbox(
            self.toc_frame,
            relief=tk.FLAT,
            bd=0,
            highlightthickness=1,
            activestyle="none",
            exportselection=False,
            yscrollcommand=self.toc_scroll.set,
        )
        self.toc_scroll.config(command=self.toc_list.yview)
        self.toc_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.toc_list.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.toc_list.bind("<<ListboxSelect>>", self._on_toc_clicked)

        # Área Central da Folha
        self.workspace = tk.Frame(self.body)
        self.workspace.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=28, pady=18)

        self.sheet_border = tk.Frame(self.workspace, bd=1, relief=tk.SOLID)
        self.sheet_border.pack(fill=tk.BOTH, expand=True)

        self.text_scroll = ttk.Scrollbar(self.sheet_border, orient=tk.VERTICAL)
        self.text_scroll.pack(side=tk.RIGHT, fill=tk.Y)

        self.text_area = tk.Text(
            self.sheet_border,
            wrap=tk.WORD,
            relief=tk.FLAT,
            bd=0,
            highlightthickness=0,
            padx=self.page_margin,
            pady=32,
            yscrollcommand=self.text_scroll.set,
            state=tk.DISABLED,
            cursor="arrow",
        )
        self.text_area.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.text_scroll.config(command=self.text_area.yview)

        # Rodapé
        self.footer_border = tk.Frame(self, height=1)
        self.footer_border.pack(side=tk.BOTTOM, fill=tk.X)
        self.statusbar = tk.Frame(self, height=28)
        self.statusbar.pack(side=tk.BOTTOM, fill=tk.X)

        self.lbl_status_left = tk.Label(self.statusbar, text="Pronto")
        self.lbl_status_left.pack(side=tk.LEFT, padx=12, pady=3)

        self.lbl_status_right = tk.Label(self.statusbar, text="Setas Esquerda/Direita: Navegar  |  Ctrl+O: Abrir")
        self.lbl_status_right.pack(side=tk.RIGHT, padx=12, pady=3)

    def apply_theme(self) -> None:
        t = THEMES[self.theme_key]
        self.configure(bg=t["bg_workspace"])
        self.toolbar.configure(bg=t["bg_toolbar"])
        self.toolbar_border.configure(bg=t["border"])
        self.tb_left.configure(bg=t["bg_toolbar"])
        self.tb_right.configure(bg=t["bg_toolbar"])
        self.body.configure(bg=t["bg_workspace"])
        self.sidebar.configure(bg=t["bg_sidebar"])
        self.sidebar_border.configure(bg=t["border"])
        self.search_row.configure(bg=t["bg_sidebar"])
        self.toc_frame.configure(bg=t["bg_sidebar"])
        self.workspace.configure(bg=t["bg_workspace"])
        self.sheet_border.configure(bg=t["border"])
        self.footer_border.configure(bg=t["border"])
        self.statusbar.configure(bg=t["bg_toolbar"])

        self.lbl_doc_title.configure(bg=t["bg_toolbar"], fg=t["fg_primary"])
        self.lbl_total_sec.configure(bg=t["bg_toolbar"], fg=t["fg_secondary"])
        self.lbl_f_size.configure(bg=t["bg_toolbar"], fg=t["fg_secondary"], text=f"{self.font_size}pt")
        self.lbl_toc_caption.configure(bg=t["bg_sidebar"], fg=t["fg_muted"])
        self.lbl_status_left.configure(bg=t["bg_toolbar"], fg=t["fg_secondary"])
        self.lbl_status_right.configure(bg=t["bg_toolbar"], fg=t["fg_muted"])

        for b in (
            self.btn_toggle_toc,
            self.btn_prev,
            self.btn_next,
            self.btn_visual,
            self.btn_f_dec,
            self.btn_f_inc,
            self.btn_search,
        ):
            b.configure(bg=t["bg_control"], fg=t["fg_primary"], activebackground=t["accent"], activeforeground="#FFFFFF")

        self.btn_open.configure(bg=t["accent"], fg="#FFFFFF", activebackground=t["accent"], activeforeground="#FFFFFF")

        for k, b in self.theme_buttons.items():
            if k == self.theme_key:
                b.configure(bg=t["accent"], fg="#FFFFFF")
            else:
                b.configure(bg=t["bg_control"], fg=t["fg_primary"])

        self.entry_sec.configure(bg=t["bg_page"], fg=t["fg_primary"], insertbackground=t["fg_primary"])
        self.entry_search.configure(bg=t["bg_page"], fg=t["fg_primary"], insertbackground=t["fg_primary"])

        self.toc_list.configure(
            bg=t["bg_page"],
            fg=t["fg_primary"],
            highlightbackground=t["border"],
            highlightcolor=t["accent"],
            selectbackground=t["accent"],
            selectforeground="#FFFFFF",
            font=("Segoe UI", 9),
        )

        self.text_area.configure(
            bg=t["bg_page"],
            fg=t["fg_primary"],
            selectbackground=t["accent"],
            selectforeground="#FFFFFF",
            font=(self.font_family, self.font_size),
            spacing1=2,
            spacing2=self.line_spacing,
            spacing3=self.line_spacing + 4,
            padx=self.page_margin,
        )

        self.text_area.tag_configure("h1", font=(self.font_family, self.font_size + 7, "bold"), spacing1=14, spacing3=10)
        self.text_area.tag_configure("h2", font=(self.font_family, self.font_size + 4, "bold"), spacing1=12, spacing3=8)
        self.text_area.tag_configure("h3", font=(self.font_family, self.font_size + 2, "bold"), spacing1=8, spacing3=6)
        self.text_area.tag_configure("h4", font=(self.font_family, self.font_size + 1, "bold"))
        self.text_area.tag_configure("bold", font=(self.font_family, self.font_size, "bold"))
        self.text_area.tag_configure("italic", font=(self.font_family, self.font_size, "italic"))
        self.text_area.tag_configure(
            "quote",
            font=(self.font_family, self.font_size, "italic"),
            foreground=t["fg_secondary"],
            lmargin1=28,
            lmargin2=28,
        )
        self.text_area.tag_configure("mono", font=("Consolas", max(9, self.font_size - 1)), background=t["bg_control"])
        self.text_area.tag_configure("link", foreground=t["accent"], underline=True)
        self.text_area.tag_configure("hit", background=t["highlight"], foreground="#000000")

        self._write_state()

    def set_theme(self, key: str) -> None:
        self.theme_key = key
        self.apply_theme()

    def adjust_font(self, delta: int) -> None:
        self.font_size = max(9, min(30, self.font_size + delta))
        self.apply_theme()

    def _on_font_change(self, _e: object = None) -> None:
        self.font_family = self.font_var.get()
        self.apply_theme()

    def toggle_sidebar(self) -> None:
        if self.sidebar_open:
            self.sidebar.pack_forget()
            self.sidebar_border.pack_forget()
            self.sidebar_open = False
        else:
            self.workspace.pack_forget()
            self.sidebar.pack(side=tk.LEFT, fill=tk.Y)
            self.sidebar_border.pack(side=tk.LEFT, fill=tk.Y)
            self.workspace.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=28, pady=18)
            self.sidebar_open = True

    def launch_visual_window(self) -> None:
        """Abre o renderizador gráfico HTML5 em uma janela de aplicativo dedicada (Edge/Chrome --app)."""
        html_file = self.base_dir / "portable_book_reader.html"
        if not html_file.is_file():
            messagebox.showwarning("Modo Visual", "O arquivo portable_book_reader.html não foi encontrado na pasta.")
            return
        url = html_file.as_uri()
        for browser in ("msedge", "chrome"):
            exe = shutil.which(browser)
            if exe:
                subprocess.Popen([exe, f"--app={url}"])
                return
        # Fallback para o navegador padrão do sistema
        if sys.platform == "win32":
            os.startfile(str(html_file))  # type: ignore[attr-defined]

    def _render_empty_screen(self) -> None:
        self.text_area.configure(state=tk.NORMAL)
        self.text_area.delete("1.0", tk.END)
        self.text_area.insert(tk.END, "Leitor Portátil de Livros\n\n", ("h1",))
        self.text_area.insert(
            tk.END,
            "Clique em 'Abrir Arquivo...' na barra superior (ou pressione Ctrl+O) para selecionar um livro nos formatos EPUB, MOBI, AZW, PRC, PDF ou TXT.\n\n",
            (),
        )
        books = self.state_data.get("books", {})
        if books:
            self.text_area.insert(tk.END, "Leituras Recentes\n\n", ("h2",))
            for path_str, info in list(books.items())[-8:]:
                t = info.get("title", Path(path_str).name)
                fmt = info.get("format", "")
                idx = info.get("index", 0) + 1
                tot = info.get("total", 1)
                self.text_area.insert(tk.END, f"• {t} [{fmt}] — Seção {idx}/{tot}\n  {path_str}\n\n", ())
        self.text_area.configure(state=tk.DISABLED)

    def prompt_open_file(self) -> None:
        fp = filedialog.askopenfilename(
            title="Abrir Livro",
            filetypes=[
                ("Livros Suportados", "*.epub *.mobi *.azw *.azw3 *.prc *.pdf *.txt *.html *.htm"),
                ("EPUB", "*.epub"),
                ("Kindle MOBI / AZW", "*.mobi *.azw *.prc"),
                ("PDF", "*.pdf"),
                ("Texto / HTML", "*.txt *.html *.htm"),
                ("Todos os arquivos", "*.*"),
            ],
        )
        if fp:
            self.open_book(fp)

    def open_book(self, file_path: str) -> None:
        ext = Path(file_path).suffix.lower()
        try:
            if ext == ".epub":
                parsed = parse_epub_file(file_path)
            elif ext in (".mobi", ".azw", ".azw3", ".prc"):
                parsed = parse_mobi_file(file_path)
            elif ext == ".pdf":
                parsed = parse_pdf_file(file_path)
            else:
                raw_txt = Path(file_path).read_text(encoding="utf-8", errors="replace")
                if ext in (".html", ".htm"):
                    segs, plain, _ = html_to_structured(raw_txt)
                else:
                    segs, plain = [(raw_txt, (), None)], raw_txt
                parsed = {
                    "title": Path(file_path).stem,
                    "author": "Texto",
                    "format": "TXT",
                    "sections": [{"title": "Documento", "segments": segs, "text": plain}],
                    "toc": [{"label": "Início", "sectionIndex": 0}],
                    "path_to_idx": {},
                }

            self.book_path = str(Path(file_path).resolve())
            self.book_title = parsed["title"]
            self.book_author = parsed["author"]
            self.book_format = parsed["format"]
            self.sections = parsed["sections"]
            self.toc = parsed["toc"]
            self.path_to_idx = parsed.get("path_to_idx", {})

            saved = self.state_data.get("books", {}).get(self.book_path, {})
            s_idx = saved.get("index", 0)
            self.current_index = s_idx if 0 <= s_idx < len(self.sections) else 0

            self.lbl_doc_title.configure(text=f"{self.book_title} — {self.book_author} ({self.book_format})")
            self._build_toc_list()
            self.render_section()
        except Exception as exc:
            messagebox.showerror("Erro ao Abrir Arquivo", f"Não foi possível abrir {Path(file_path).name}:\n{exc}")

    def _build_toc_list(self) -> None:
        self.toc_list.delete(0, tk.END)
        for item in self.toc:
            self.toc_list.insert(tk.END, item["label"])

    def render_section(self, highlight: str = "") -> None:
        if not self.sections:
            return
        self.current_index = max(0, min(len(self.sections) - 1, self.current_index))
        sec = self.sections[self.current_index]

        self.text_area.configure(state=tk.NORMAL)
        self.text_area.delete("1.0", tk.END)

        link_counter = 0
        for chunk, styles, link_target in sec["segments"]:
            tags = list(styles)
            if link_target:
                link_counter += 1
                ltag = f"lnk_{link_counter}"
                tags.append(ltag)
                self.text_area.tag_bind(ltag, "<Enter>", lambda e: self.text_area.configure(cursor="hand2"))
                self.text_area.tag_bind(ltag, "<Leave>", lambda e: self.text_area.configure(cursor="arrow"))
                self.text_area.tag_bind(ltag, "<Button-1>", lambda e, tgt=link_target: self._follow_internal_link(tgt))
            self.text_area.insert(tk.END, chunk, tuple(tags))

        if highlight:
            pos = "1.0"
            while True:
                found = self.text_area.search(highlight, pos, stopindex=tk.END, nocase=True)
                if not found:
                    break
                end_pos = f"{found}+{len(highlight)}c"
                self.text_area.tag_add("hit", found, end_pos)
                pos = end_pos

        self.text_area.configure(state=tk.DISABLED)
        self.text_area.yview_moveto(0.0)

        total = len(self.sections)
        cur = self.current_index + 1
        pct = int(round((cur / max(1, total)) * 100))

        self.entry_sec.delete(0, tk.END)
        self.entry_sec.insert(0, str(cur))
        self.lbl_total_sec.configure(text=f"/ {total}")
        self.lbl_status_left.configure(text=f"{self.book_format}  ·  {sec['title']}  (Seção {cur} de {total} — {pct}%)")

        # Sincronizar seleção no Sumário
        self.toc_list.selection_clear(0, tk.END)
        for i, item in enumerate(self.toc):
            if item["sectionIndex"] == self.current_index:
                self.toc_list.selection_set(i)
                self.toc_list.see(i)
                break

        self._write_state()

    def _follow_internal_link(self, target: str) -> None:
        if target.startswith("filepos:"):
            fp = int(target.split(":", 1)[1])
            idx = next(
                (i for i, s in enumerate(self.sections) if abs(s.get("fileposStart", -999) - fp) <= 32),
                -1,
            )
            if idx == -1:
                idx = next(
                    (i for i, s in enumerate(self.sections) if s.get("fileposStart", 0) <= fp < s.get("fileposEnd", 0)),
                    -1,
                )
            if idx != -1:
                self.current_index = idx
                self.render_section()
        elif target.startswith("href:"):
            href = target.split(":", 1)[1]
            cur_path = self.sections[self.current_index].get("path", "")
            resolved = _resolve_zip_path(cur_path, href) if cur_path else href.split("#")[0]
            if resolved in self.path_to_idx:
                self.current_index = self.path_to_idx[resolved]
                self.render_section()

    def step_section(self, delta: int) -> None:
        if not self.sections:
            return
        nxt = self.current_index + delta
        if 0 <= nxt < len(self.sections):
            self.current_index = nxt
            self.render_section()

    def _key_step(self, event: tk.Event, delta: int) -> None:
        if isinstance(event.widget, tk.Entry):
            return
        self.step_section(delta)

    def _on_jump_entry(self, _e: object = None) -> None:
        if not self.sections:
            return
        try:
            val = int(self.entry_sec.get().strip())
            self.current_index = max(0, min(len(self.sections) - 1, val - 1))
            self.render_section()
        except ValueError:
            pass

    def _on_toc_clicked(self, _e: object = None) -> None:
        sel = self.toc_list.curselection()
        if sel and sel[0] < len(self.toc):
            self.current_index = self.toc[sel[0]]["sectionIndex"]
            self.render_section()

    def find_next(self) -> None:
        q = self.entry_search.get().strip()
        if not q or not self.sections:
            return
        ql = q.lower()
        total = len(self.sections)
        for offset in range(1, total + 1):
            idx = (self.current_index + offset) % total
            if ql in self.sections[idx].get("text", "").lower():
                self.current_index = idx
                self.render_section(highlight=q)
                return
        messagebox.showinfo("Buscar", f"Nenhuma ocorrência encontrada para '{q}'.")


if __name__ == "__main__":
    initial = sys.argv[1] if len(sys.argv) > 1 else None
    app = BookReaderApp(initial_file=initial)
    app.mainloop()
