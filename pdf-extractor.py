#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Crea una COPIA del PDF donde solo queda visible lo resaltado,
manteniendo el formato original (sin rasterizar lo resaltado),
mediante REDACCIONES del complemento (todo lo que NO está resaltado).

Requisitos:
  pip install PyMuPDF
"""

import fitz  # PyMuPDF
from pathlib import Path

# ====== Ajusta aquí ======
ORIG = "/Users/rdgztorres19/Library/CloudStorage/OneDrive-Personal/_OceanofPDF.com_ASPNET_Core_in_Action_Third_Edition_-_Andrew_Lock.pdf"   # ← tu PDF origen
OUT  = None                       # ← None = "archivo__solo-resaltado.pdf"
MARGIN = 0.5                      # Expande levemente cada highlight (pts)
MERGE_Y_TOL = 2.0                 # Tolerancia para agrupar en la misma línea
MERGE_X_GAP = 10.0                # Hueco horizontal máximo para unir trozos
# =========================

def nombre_salida(path_in: Path, sufijo="__resume") -> Path:
    return path_in.with_name(f"{path_in.stem}{sufijo}{path_in.suffix}")

def get_highlight_rects(page: fitz.Page, margin=MARGIN):
    rects = []
    annots = list(page.annots()) if page.annots() else []
    
    if len(annots) > 0:
        print(f"  📋 Página {page.number}: {len(annots)} anotaciones encontradas")
    
    for a in annots:
        # Tipos de anotación comunes para highlights:
        # 8 = Highlight, 9 = Underline, 10 = Strikeout, 11 = Squiggly
        annot_type = a.type[0] if isinstance(a.type, tuple) else a.type
        
        if annot_type in [8, 9, 10, 11]:  # Diferentes tipos de resaltado
            try:
                # Intentar obtener vertices (quads)
                if hasattr(a, 'vertices') and a.vertices:
                    quads = a.vertices
                    for i in range(0, len(quads), 4):
                        if i + 3 < len(quads):
                            quad_points = quads[i:i+4]
                            r = fitz.Quad(quad_points).rect
                            r = (r + (-margin, -margin, margin, margin)) & page.rect
                            if not r.is_empty and r.width > 0 and r.height > 0:
                                rects.append(r)
                
                # Fallback: usar el rectángulo de la anotación directamente
                elif hasattr(a, 'rect'):
                    r = a.rect
                    r = (r + (-margin, -margin, margin, margin)) & page.rect
                    if not r.is_empty and r.width > 0 and r.height > 0:
                        rects.append(r)
                        
            except Exception as e:
                # Último recurso: usar rect de la anotación
                try:
                    r = a.rect
                    if r and not r.is_empty:
                        r = (r + (-margin, -margin, margin, margin)) & page.rect
                        if not r.is_empty and r.width > 0 and r.height > 0:
                            rects.append(r)
                except:
                    pass
    
    if len(rects) > 0:
        print(f"  ✅ {len(rects)} highlights encontrados")
    return rects

def merge_line_rects(rects, y_tol=MERGE_Y_TOL, x_gap=MERGE_X_GAP):
    """Une rectángulos de la misma línea para evitar tiras finas."""
    if not rects:
        return []
    rects = sorted(rects, key=lambda r: (round(r.y0, 2), r.x0))
    lines = []
    for r in rects:
        placed = False
        for line in lines:
            # media de y0 de la línea
            ly0 = sum(x.y0 for x in line) / len(line)
            if abs(r.y0 - ly0) <= y_tol:
                line.append(r); placed = True; break
        if not placed:
            lines.append([r])

    merged = []
    for line in lines:
        line = sorted(line, key=lambda r: r.x0)
        cur = line[0]
        for r in line[1:]:
            same_band = (abs(r.y0 - cur.y0) <= y_tol and abs(r.y1 - cur.y1) <= y_tol)
            if same_band and r.x0 <= cur.x1 + x_gap:
                cur = fitz.Rect(min(cur.x0, r.x0), min(cur.y0, r.y0),
                                max(cur.x1, r.x1), max(cur.y1, r.y1))
            else:
                merged.append(cur); cur = r
        merged.append(cur)
    # Orden lectura
    return sorted(merged, key=lambda r: (r.y0, r.x0))

def add_rect_redaction(page: fitz.Page, rect: fitz.Rect, color=(1,1,1)):
    """Añade una redacción rectangular (relleno blanco por defecto)."""
    # Verificar que el rectángulo sea válido
    if rect.is_empty or rect.width <= 0 or rect.height <= 0:
        return
    
    # Asegurar que el rectángulo esté dentro de los límites de la página
    rect = rect & page.rect
    if not rect.is_empty:
        page.add_redact_annot(rect, fill=color, text=None, align=0)

def redact_complement(page: fitz.Page, kept_rects):
    """
    Inserta redacciones para TODO lo que NO está dentro de kept_rects.
    Se hace con rectángulos:
      - banda superior, huecos entre líneas, banda inferior (a todo ancho);
      - para cada línea: izquierda y derecha de cada rect;
      - huecos horizontales entre rects de la misma línea.
    """
    if not kept_rects:
        # Nada que mantener → redacción de toda la página
        add_rect_redaction(page, page.rect)
        return

    W = page.rect.width
    H = page.rect.height

    # 1) Banda superior
    top = kept_rects[0].y0
    if top > 0:
        add_rect_redaction(page, fitz.Rect(0, 0, W, top))

    # 2) Procesar por “líneas” (bandas horizontales)
    # agrupamos por solape vertical
    bands = []
    for r in kept_rects:
        placed = False
        for band in bands:
            # si se solapan verticalmente, pertenecen a la misma banda
            if not (r.y0 > band["y1"] or r.y1 < band["y0"]):
                band["y0"] = min(band["y0"], r.y0)
                band["y1"] = max(band["y1"], r.y1)
                band["rects"].append(r)
                placed = True
                break
        if not placed:
            bands.append({"y0": r.y0, "y1": r.y1, "rects": [r]})

    # ordenar bandas por Y
    bands.sort(key=lambda b: b["y0"])

    prev_y1 = top
    for band in bands:
        y0, y1 = band["y0"], band["y1"]
        rects_line = sorted(band["rects"], key=lambda r: r.x0)

        # 2a) Hueco entre bandas (a todo ancho)
        if y0 > prev_y1:
            add_rect_redaction(page, fitz.Rect(0, prev_y1, W, y0))

        # 2b) Dentro de la banda: cubrir izquierda de primer rect y entre rects, y derecha del último
        # Izquierda
        first = rects_line[0]
        if first.x0 > 0:
            add_rect_redaction(page, fitz.Rect(0, y0, first.x0, y1))

        # Entre rects
        for a, b in zip(rects_line, rects_line[1:]):
            # zona entre a.x1 y b.x0, en la franja y0..y1 (o solape vertical exacto de a y b)
            ix0 = a.x1
            ix1 = b.x0
            if ix1 > ix0:
                add_rect_redaction(page, fitz.Rect(ix0, max(y0, a.y0, b.y0), ix1, min(y1, a.y1, b.y1)))

        # Derecha
        last = rects_line[-1]
        if last.x1 < W:
            add_rect_redaction(page, fitz.Rect(last.x1, y0, W, y1))

        prev_y1 = y1

    # 3) Banda inferior
    if prev_y1 < H:
        add_rect_redaction(page, fitz.Rect(0, prev_y1, W, H))

def main():
    print("🚀 Iniciando extractor de highlights PDF...")
    
    in_path = Path(ORIG)
    if not in_path.exists():
        raise FileNotFoundError(f"❌ No existe el PDF de origen: {in_path}")

    out_path = Path(OUT) if OUT else nombre_salida(in_path)
    print(f"📄 Archivo origen: {in_path.name}")
    print(f"📝 Archivo destino: {out_path.name}")

    try:
        src = fitz.open(in_path.as_posix())
        print(f"✅ PDF abierto exitosamente: {len(src)} páginas")
    except Exception as e:
        raise Exception(f"❌ Error abriendo PDF: {e}")

    out = fitz.open()

    # Copiar metadatos
    try:
        if src.metadata:
            out.set_metadata(src.metadata)
            print("✅ Metadatos copiados")
    except Exception as e:
        print(f"⚠️ No se pudieron copiar metadatos: {e}")

    total_highlights = 0
    current_y_position = 0  # Para apilar highlights verticalmente
    current_page = None
    margin = 7        # Reducido de 20 a 15
    
    # Primero, encontrar el tamaño máximo de todas las páginas con highlights
    max_page_width = 0
    max_page_height = 0
    
    print("🔍 Analizando tamaños de página...")
    for i in range(len(src)):
        page = src.load_page(i)
        highlight_rects = get_highlight_rects(page)
        if highlight_rects:
            # Esta página tiene highlights, considerar su tamaño
            if page.rect.width > max_page_width:
                max_page_width = page.rect.width
            if page.rect.height > max_page_height:
                max_page_height = page.rect.height
    
    # Usar el tamaño máximo encontrado, o A4 como fallback
    page_width = max_page_width if max_page_width > 0 else 595
    page_height = max_page_height if max_page_height > 0 else 842
    
    print(f"📐 Tamaño de página determinado: {page_width:.0f} x {page_height:.0f} pts")
    
    # Trabajamos página por página buscando highlights
    for i in range(len(src)):
        print(f"\n📄 Procesando página {i + 1}/{len(src)}...")
        page = src.load_page(i)

        # Buscar highlights en esta página
        highlight_rects = get_highlight_rects(page)
        if highlight_rects:
            total_highlights += len(highlight_rects)
            merged_rects = merge_line_rects(highlight_rects)
            print(f"  🔗 Después de merge: {len(merged_rects)} rectángulos")
            
            # Para cada rectángulo de highlight, extraerlo y añadirlo al documento de salida
            for rect_index, rect in enumerate(merged_rects):
                # Usar altura original sin escalar para mejor espaciado
                total_item_height = rect.height + margin
                
                # Crear nueva página si es necesario o si no cabe en la actual
                if current_page is None or current_y_position + total_item_height > page_height - margin:
                    # Crear nueva página con el tamaño original del PDF
                    current_page = out.new_page(width=page_width, height=page_height)
                    current_y_position = margin
                    print(f"  📄 Nueva página creada (tamaño original: {page_width:.0f}x{page_height:.0f})")
                
                # Preservar la posición horizontal original
                dest_x0 = margin + rect.x0
                dest_x1 = dest_x0 + rect.width
                
                # Solo ajustar si se sale del ancho de página
                if dest_x1 > page_width - margin:
                    # Escalar solo si es absolutamente necesario
                    available_width = page_width - (2 * margin)
                    scale_needed = available_width / (rect.width + rect.x0)
                    dest_x0 = margin + (rect.x0 * scale_needed)
                    dest_x1 = dest_x0 + (rect.width * scale_needed)
                    final_height = rect.height * scale_needed
                    print(f"    ⚠️ Escalado necesario: {scale_needed:.2f}x")
                else:
                    # Mantener tamaño original
                    final_height = rect.height
                
                dest_rect = fitz.Rect(
                    dest_x0,
                    current_y_position,
                    dest_x1,
                    current_y_position + final_height
                )
                
                # Copiar el contenido del highlight a la nueva posición
                current_page.show_pdf_page(dest_rect, src, i, clip=rect)
                print(f"  ✅ Highlight {rect_index + 1}: {dest_rect}")
                
                # Actualizar posición Y para el siguiente highlight
                current_y_position += final_height + margin
        else:
            print(f"  ⚠️ No se encontraron highlights en esta página - SALTANDO")

    print(f"\n📊 Resumen:")
    print(f"   Total highlights encontrados: {total_highlights}")
    print(f"   Páginas procesadas: {len(src)}")
    print(f"   Páginas de salida creadas: {len(out)}")
    print(f"   Tamaño de página usado: {page_width:.0f}x{page_height:.0f} pts (del PDF original)")

    # Si no hubo highlights, crear página con mensaje
    if len(out) == 0:
        p = out.new_page(width=page_width, height=page_height)
        p.insert_text((50, 100), "No se encontraron highlights en el PDF.", fontsize=14, fontname="helv")
        print("  📝 Página con mensaje de 'no highlights' creada")

    try:
        out.save(out_path.as_posix())
        print(f"✅ Archivo guardado: {out_path}")
    except Exception as e:
        print(f"❌ Error guardando archivo: {e}")
        raise
    finally:
        out.close()
        src.close()
        
    print(f"\n🎉 Proceso completado!")
    print(f"📄 Original intacto: {in_path.name}")
    print(f"📝 Copia generada:  {out_path.name}")
    
    if total_highlights == 0:
        print("⚠️ ADVERTENCIA: No se encontraron highlights en el PDF.")
        print("   Verifica que el PDF tenga texto resaltado.")
    else:
        print(f"✅ Se extrajeron {total_highlights} highlights usando el tamaño original del PDF.")

if __name__ == "__main__":
    main()
