"""Rasterize PDF to per-page images (no LlamaParse)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pdf2image import convert_from_path


@dataclass(frozen=True)
class PageAsset:
    """One physical page after rasterization (1-based page index)."""

    page: int
    path: Path


def _dpi() -> int:
    return int(os.environ.get("PAGE_RASTER_DPI", "150"))


def _max_side() -> int | None:
    raw = os.environ.get("PAGE_RASTER_MAX_SIDE", "2048").strip()
    if raw == "" or raw.lower() in ("0", "none", "off"):
        return None
    return int(raw) if raw.isdigit() else 2048


def _resize_if_needed(img, max_side: int | None):
    if not max_side:
        return img
    from PIL import Image

    if not isinstance(img, Image.Image):
        return img
    w, h = img.size
    if max(w, h) <= max_side:
        return img
    scale = max_side / float(max(w, h))
    nw = max(1, int(w * scale))
    nh = max(1, int(h * scale))
    return img.resize((nw, nh), Image.Resampling.LANCZOS)


def rasterize_pdf_to_dir(
    pdf_path: Path,
    out_dir: Path,
    *,
    prefix: str = "page",
    dpi: int | None = None,
    max_side: int | None = None,
) -> tuple[list[PageAsset], dict[str, Any]]:
    """
    Render each PDF page to PNG under out_dir: {prefix}_{n:04d}.png.

    Requires poppler (pdf2image). Returns PageAsset list and metadata.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    eff_dpi = dpi if dpi is not None else _dpi()
    eff_max_side = _max_side() if max_side is None else max_side
    images = convert_from_path(str(pdf_path), dpi=eff_dpi)
    assets: list[PageAsset] = []
    for i, pil_img in enumerate(images, start=1):
        pil_img = _resize_if_needed(pil_img, eff_max_side)
        name = f"{prefix}_{i:04d}.png"
        dest = out_dir / name
        pil_img.save(dest, "PNG", optimize=True)
        assets.append(PageAsset(page=i, path=dest))
    meta: dict[str, Any] = {
        "total_pages": len(assets),
        "dpi": eff_dpi,
        "format": "png",
        "source_pdf": str(pdf_path),
    }
    return assets, meta


def import_ordered_images_to_dir(
    image_paths: list[Path],
    out_dir: Path,
    *,
    prefix: str = "page",
    max_side: int | None = None,
) -> tuple[list[PageAsset], dict[str, Any]]:
    """
    Copy or convert ordered image files to PNG pages under out_dir (one page per file, 1-based index).
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    eff_max_side = _max_side() if max_side is None else max_side
    from PIL import Image

    assets: list[PageAsset] = []
    for i, src in enumerate(image_paths, start=1):
        img = Image.open(src).convert("RGB")
        img = _resize_if_needed(img, eff_max_side)
        name = f"{prefix}_{i:04d}.png"
        dest = out_dir / name
        img.save(dest, "PNG", optimize=True)
        assets.append(PageAsset(page=i, path=dest))
    meta: dict[str, Any] = {
        "total_pages": len(assets),
        "format": "png",
        "source": "image_set",
    }
    return assets, meta
