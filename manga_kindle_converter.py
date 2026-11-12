#!/usr/bin/env python3
"""
Manga Kindle Converter (KCC & Calibre RTL Standalone CLI)
Converte arquivos .CBZ, .ZIP ou .EPUB de mangás para o formato EPUB 3 com
ordem de leitura japonesa da Direita para a Esquerda (RTL) e Layout Fixo,
100% compatível com o Amazon Kindle e o serviço 'Send to Kindle'.

Uso:
  python manga_kindle_converter.py arquivo.cbz
  python manga_kindle_converter.py arquivo.epub
  python manga_kindle_converter.py "C:\\Caminho\\Para\\Pasta_Com_Mangas"
"""

import sys
import os
import re
import zipfile
import pathlib

def natural_sort_key(s):
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', str(s))]

def fix_epub_rtl(epub_path: pathlib.Path, out_path: pathlib.Path, direction: str = "rtl"):
    print(f"-> Processando EPUB: {epub_path.name}")
    with zipfile.ZipFile(epub_path, 'r') as zin, zipfile.ZipFile(out_path, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.lower().endswith('.opf'):
                try:
                    text = data.decode('utf-8')
                    if 'page-progression-direction' in text:
                        text = re.sub(r'page-progression-direction="[^"]*"', f'page-progression-direction="{direction}"', text, flags=re.I)
                    else:
                        text = re.sub(r'<spine\b([^>]*)>', rf'<spine\1 page-progression-direction="{direction}">', text, count=1, flags=re.I)
                    if 'rendition:layout' not in text:
                        text = text.replace('</metadata>', '  <meta property="rendition:layout">pre-paginated</meta>\n  <meta property="rendition:orientation">auto</meta>\n</metadata>')
                    data = text.encode('utf-8')
                except Exception as e:
                    print(f"   Aviso ao ajustar OPF: {e}")
            zout.writestr(item, data)
    print(f"   [OK] Salvo: {out_path.name}")

def convert_cbz_to_kindle_epub(cbz_path: pathlib.Path, out_path: pathlib.Path, direction: str = "rtl"):
    print(f"-> Convertendo CBZ/ZIP: {cbz_path.name}")
    title = cbz_path.stem

    with zipfile.ZipFile(cbz_path, 'r') as zin:
        img_names = [name for name in zin.namelist() if re.search(r'\.(jpe?g|png|webp|avif|bmp)$', name, re.I) and not '__MACOSX' in name]
        if not img_names:
            print(f"   [PULADO] Nenhuma imagem encontrada em {cbz_path.name}")
            return
        img_names.sort(key=natural_sort_key)

        with zipfile.ZipFile(out_path, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
            # 1. mimetype (sem compressão conforme spec EPUB)
            zout.writestr('mimetype', b'application/epub+zip', compress_type=zipfile.ZIP_STORED)

            # 2. container.xml
            container_xml = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""
            zout.writestr('META-INF/container.xml', container_xml.encode('utf-8'))

            manifest_items = []
            spine_items = []
            nav_items = []

            for idx, img_name in enumerate(img_names):
                p_num = idx + 1
                ext = pathlib.Path(img_name).suffix.lstrip('.').lower()
                mime = 'image/png' if ext == 'png' else ('image/webp' if ext == 'webp' else 'image/jpeg')
                img_dest = f"OEBPS/images/p_{p_num:04d}.{ext}"
                page_dest = f"OEBPS/pages/p_{p_num:04d}.xhtml"

                # Escreve imagem
                img_data = zin.read(img_name)
                zout.writestr(img_dest, img_data)

                # Escreve página XHTML
                page_xhtml = f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Pág. {p_num}</title>
  <meta name="viewport" content="width=1200, height=1600" />
  <style type="text/css">
    @page {{ margin: 0; padding: 0; }}
    body {{ margin: 0; padding: 0; background-color: #000; text-align: center; }}
    img {{ width: 100vw; height: 100vh; object-fit: contain; }}
  </style>
</head>
<body><img src="../images/p_{p_num:04d}.{ext}" alt="Pág {p_num}" /></body>
</html>"""
                zout.writestr(page_dest, page_xhtml.encode('utf-8'))

                manifest_items.append(f'<item id="img_{p_num}" href="images/p_{p_num:04d}.{ext}" media-type="{mime}"/>')
                manifest_items.append(f'<item id="page_{p_num}" href="pages/p_{p_num:04d}.xhtml" media-type="application/xhtml+xml"/>')
                spine_items.append(f'<itemref idref="page_{p_num}"/>')
                nav_items.append(f'<navPoint id="nav_{p_num}" playOrder="{p_num}"><navLabel><text>Página {p_num}</text></navLabel><content src="pages/p_{p_num:04d}.xhtml"/></navPoint>')

            # content.opf
            manifest_str = "\n    ".join(manifest_items)
            spine_str = "\n    ".join(spine_items)
            opf_xml = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>{title}</dc:title>
    <dc:language>ja</dc:language>
    <dc:identifier id="BookId">urn:uuid:{abs(hash(title))}</dc:identifier>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">auto</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    {manifest_str}
  </manifest>
  <spine page-progression-direction="{direction}" toc="ncx">
    {spine_str}
  </spine>
</package>"""
            zout.writestr('OEBPS/content.opf', opf_xml.encode('utf-8'))

            # toc.ncx
            nav_str = "\n  ".join(nav_items)
            ncx_xml = f"""<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:{abs(hash(title))}"/></head>
  <docTitle><text>{title}</text></docTitle>
  <navMap>
  {nav_str}
  </navMap>
</ncx>"""
            zout.writestr('OEBPS/toc.ncx', ncx_xml.encode('utf-8'))

    print(f"   [OK] Convertido com sucesso: {out_path.name}")

def process_path(target_path: str, direction: str = "rtl"):
    p = pathlib.Path(target_path.strip('\'"'))
    if not p.exists():
        print(f"Erro: Caminho não encontrado: {p}")
        return

    files_to_convert = []
    if p.is_file():
        files_to_convert.append(p)
    elif p.is_dir():
        for ext in ('*.cbz', '*.zip', '*.epub'):
            files_to_convert.extend(p.glob(ext))

    if not files_to_convert:
        print("Nenhum arquivo .cbz, .zip ou .epub encontrado para conversão.")
        return

    print(f"\nIniciando conversão de {len(files_to_convert)} arquivo(s) para Mangá Kindle ({direction.upper()})...\n")

    for f in files_to_convert:
        if f.name.endswith(f"_Kindle_{direction.upper()}.epub"):
            continue # Não reprocessa arquivo já convertido
        out_name = f.stem + f"_Kindle_{direction.upper()}.epub"
        out_path = f.parent / out_name

        try:
            if f.suffix.lower() == '.epub':
                fix_epub_rtl(f, out_path, direction)
            else:
                convert_cbz_to_kindle_epub(f, out_path, direction)
        except Exception as e:
            print(f"   [ERRO] Falha ao processar {f.name}: {e}")

    print("\nConcluído! Todos os arquivos estão prontos para envio no Send to Kindle oficial da Amazon:")
    print("https://www.amazon.com/sendtokindle\n")

if __name__ == '__main__':
    args = sys.argv[1:]
    if args:
        target = args[0]
        direction = args[1] if len(args) > 1 else "rtl"
        process_path(target, direction)
    else:
        print("="*60)
        print("  Manga Kindle Converter (KCC & Calibre RTL Standalone)")
        print("="*60)
        user_input = input("Arraste um arquivo (.cbz/.epub) ou cole o caminho de uma pasta: ").strip()
        if user_input:
            process_path(user_input, "rtl")
        else:
            print("Nenhum caminho informado. Encerrando.")
