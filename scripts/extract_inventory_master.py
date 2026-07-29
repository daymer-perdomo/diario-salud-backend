#!/usr/bin/env python3
"""Extrae el Excel maestro de inventario a un JSON intermedio que
import-inventory-master.ts consume.

A diferencia de extract_blog_master.py (columnas por indice fijo, porque
ese Excel ya existia con un layout conocido), este extractor busca las
columnas POR NOMBRE de encabezado (fila 1) -- no se conoce todavia el
layout real del Excel de inventario de la farmacia, asi que este enfoque
tolera que las columnas esten en otro orden o se agreguen columnas nuevas,
mientras los encabezados coincidan (sin importar mayusculas/acentos).

Una fila del Excel = un (producto, sucursal): el mismo SKU puede repetirse
en varias filas, una por cada sucursal donde EcoFarma lo maneja.

Encabezados esperados (fila 1), ver HEADER_ALIASES abajo para sinonimos
aceptados:
  SKU | Nombre | Principio Activo | Categoria | Descripcion |
  Requiere Receta | Sucursal Codigo | Sucursal Nombre | Cantidad | Precio

Si el Excel real usa otros nombres de columna, ajustar HEADER_ALIASES.

Uso: python3 extract_inventory_master.py <ruta.xlsx> <limit> <ruta_salida.json>
"""
import json
import sys
import unicodedata

import openpyxl

HEADER_ALIASES = {
    "sku": "sku",
    "codigo": "sku",
    "nombre": "name",
    "producto": "name",
    "principioactivo": "activeIngredient",
    "principio activo": "activeIngredient",
    "categoria": "category",
    "descripcion": "description",
    "requierereceta": "requiresPrescription",
    "requiere receta": "requiresPrescription",
    "sucursalcodigo": "branchCode",
    "sucursal codigo": "branchCode",
    "codigosucursal": "branchCode",
    "sucursalnombre": "branchName",
    "sucursal nombre": "branchName",
    "sucursal": "branchName",
    "cantidad": "quantity",
    "stock": "quantity",
    "precio": "price",
}

TRUE_VALUES = {"si", "sí", "true", "1", "x", "yes"}


def normalize_header(value):
    if value is None:
        return None
    s = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode("ascii")
    return s.strip().lower()


def build_column_map(header_row):
    column_map = {}
    for idx, raw in enumerate(header_row):
        key = normalize_header(raw)
        field = HEADER_ALIASES.get(key)
        if field:
            column_map[field] = idx
    return column_map


def cell(row, column_map, field):
    idx = column_map.get(field)
    if idx is None or idx >= len(row) or row[idx] is None:
        return None
    s = str(row[idx]).strip()
    return s if s else None


def cell_number(row, column_map, field):
    s = cell(row, column_map, field)
    if s is None:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def cell_bool(row, column_map, field):
    s = cell(row, column_map, field)
    return s is not None and s.strip().lower() in TRUE_VALUES


def main():
    xlsx_path, limit_str, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    limit = int(limit_str)

    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    sheet = wb.worksheets[0]

    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        raise SystemExit("El Excel no tiene filas")

    column_map = build_column_map(rows[0])
    missing_required = [f for f in ("sku", "name", "branchCode", "quantity", "price") if f not in column_map]
    if missing_required:
        raise SystemExit(
            f"Faltan columnas requeridas en el encabezado (fila 1): {missing_required}. "
            f"Columnas detectadas: {list(column_map.keys())}"
        )

    items = []
    for row in rows[1 : 1 + limit]:
        sku = cell(row, column_map, "sku")
        if not sku:
            continue
        items.append(
            {
                "sku": sku,
                "name": cell(row, column_map, "name") or sku,
                "activeIngredient": cell(row, column_map, "activeIngredient"),
                "category": cell(row, column_map, "category"),
                "description": cell(row, column_map, "description"),
                "requiresPrescription": cell_bool(row, column_map, "requiresPrescription"),
                "branchCode": cell(row, column_map, "branchCode"),
                "branchName": cell(row, column_map, "branchName") or cell(row, column_map, "branchCode"),
                "quantity": int(cell_number(row, column_map, "quantity") or 0),
                "price": cell_number(row, column_map, "price") or 0,
            }
        )

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"items": items}, f, ensure_ascii=False)

    print(f"Extraidas {len(items)} filas (producto x sucursal) -> {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
