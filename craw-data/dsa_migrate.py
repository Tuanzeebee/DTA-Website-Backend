#!/usr/bin/env python3
"""
dsa_migrate.py - Rut du lieu tu site WordPress (dsa.org.vn) qua REST API.

Chay theo 3 buoc rieng biet (co checkpoint, khong lam tat ca cung luc):

  1) python dsa_migrate.py meta              -> tai toan bo metadata bai viet (JSON)
  2) python dsa_migrate.py organize          -> tach ra thu muc theo category + file .md/.html
  3) python dsa_migrate.py images            -> tai anh (featured + anh trong noi dung)

Tuy chon chung:
  --limit N       chi xu ly N bai dau (de test truoc khi chay full)
  --out DIR       thu muc output (mac dinh: ./export)
  --delay SEC     nghi giua cac request (mac dinh 1.0s)
  --per-page N    so muc moi request, mac dinh 20 (giam neu server timeout)
  --timeout SEC   timeout moi request, mac dinh 120s
  --dry-run       chi in ra se lam gi, khong ghi/tai file (chi cho buoc images)

Buoc meta co resume: neu dut giua chung, chay lai se tiep tu trang do dang.

Yeu cau: pip install requests
"""

import argparse
import json
import os
import re
import sys
import time
from html import unescape
from urllib.parse import urlparse, unquote

import requests

BASE = "https://dsa.org.vn"
API = BASE + "/wp-json/wp/v2"
UA = {"User-Agent": "dsa-migration/1.0 (content migration, authorized)"}


# ---------------------------------------------------------------- helpers

def slugify(text, maxlen=80):
    """Bien ten category/tieu de thanh ten thu muc an toan."""
    text = unescape(text)
    table = str.maketrans(
        "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợ"
        "ùúủũụưừứửữựỳýỷỹỵđ",
        "aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooo"
        "uuuuuuuuuuuyyyyyd",
    )
    text = text.lower().translate(table)
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:maxlen] or "khong-ten"


def get_json(url, params=None, delay=1.0, timeout=120):
    """GET mot endpoint, tra ve (data, headers). Retry 4 lan voi backoff."""
    for attempt in range(4):
        try:
            r = requests.get(url, params=params, headers=UA, timeout=timeout)
            r.raise_for_status()
            time.sleep(delay)
            return r.json(), r.headers
        except requests.HTTPError:
            raise  # loi HTTP that su (400 = het trang) -> khong retry
        except Exception as e:
            if attempt == 3:
                raise
            wait = 5 * (attempt + 1)
            print(f"  ! loi ({e}), thu lai sau {wait}s...", file=sys.stderr)
            time.sleep(wait)


def fetch_all(endpoint, out_path, delay, per_page=20, timeout=120):
    """Phan trang qua toan bo mot endpoint, ghi tang dan ra 1 file JSON."""
    items, page = [], 1
    # neu da co file cu thi doc lai de chay tiep (resume)
    if os.path.exists(out_path):
        items = load(out_path)
        page = len(items) // per_page + 1
        if items:
            print(f"  (tiep tuc tu trang {page}, da co {len(items)} muc)")

    while True:
        params = {"per_page": per_page, "page": page, "orderby": "id", "order": "asc"}
        try:
            data, headers = get_json(f"{API}/{endpoint}", params, delay, timeout)
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code in (400, 404):
                break  # het trang
            raise
        if not data:
            break
        items.extend(data)
        total_pages = headers.get("X-WP-TotalPages", "?")
        print(f"  {endpoint}: trang {page}/{total_pages} -> {len(items)} muc")

        # ghi sau moi trang: dut giua chung van khong mat du lieu
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)

        page += 1
        if total_pages != "?" and page > int(total_pages):
            break

    print(f"  -> da luu {len(items)} muc vao {out_path}")
    return items


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def extract_img_urls(html):
    """Lay tat ca URL anh trong <img src> cua noi dung bai viet."""
    urls = re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', html or "", re.I)
    return [u for u in dict.fromkeys(urls) if u.startswith("http")]


# ---------------------------------------------------------------- steps

def step_meta(args):
    """Buoc 1: tai metadata."""
    os.makedirs(args.out, exist_ok=True)
    print("[1/3] Tai categories...")
    fetch_all("categories", f"{args.out}/categories.json", args.delay,
              per_page=100, timeout=args.timeout)
    print(f"[1/3] Tai posts (per_page={args.per_page})...")
    fetch_all("posts", f"{args.out}/posts.json", args.delay,
              per_page=args.per_page, timeout=args.timeout)
    print(f"[1/3] Tai media library (per_page={args.per_page})...")
    fetch_all("media", f"{args.out}/media.json", args.delay,
              per_page=args.per_page, timeout=args.timeout)
    print("\nXong buoc 1. Kiem tra file JSON roi chay: organize")


def step_organize(args):
    """Buoc 2: tach bai viet ra thu muc theo category."""
    posts = load(f"{args.out}/posts.json")
    cats = {c["id"]: c["name"] for c in load(f"{args.out}/categories.json")}
    media = {m["id"]: m for m in load(f"{args.out}/media.json")}

    if args.limit:
        posts = posts[: args.limit]

    manifest = []
    for p in posts:
        cat_ids = p.get("categories") or []
        cat_name = cats.get(cat_ids[0], "uncategorized") if cat_ids else "uncategorized"
        cat_dir = os.path.join(args.out, "content", slugify(cat_name))
        os.makedirs(cat_dir, exist_ok=True)

        title = unescape(p["title"]["rendered"])
        date = p["date"][:10]
        slug = p["slug"]
        fname = f"{date}_{slugify(slug)}"

        content = p["content"]["rendered"]
        featured = media.get(p.get("featured_media"), {}).get("source_url")
        imgs = ([featured] if featured else []) + extract_img_urls(content)
        imgs = list(dict.fromkeys(imgs))

        record = {
            "id": p["id"],
            "slug": slug,
            "title": title,
            "date": p["date"],
            "modified": p["modified"],
            "link": p["link"],
            "categories": [cats.get(i, str(i)) for i in cat_ids],
            "featured_image": featured,
            "images": imgs,
            "excerpt": unescape(re.sub(r"<[^>]+>", "", p["excerpt"]["rendered"])).strip(),
            "content_file": os.path.relpath(f"{cat_dir}/{fname}.html", args.out),
        }
        manifest.append(record)

        with open(f"{cat_dir}/{fname}.html", "w", encoding="utf-8") as f:
            f.write(content)
        with open(f"{cat_dir}/{fname}.json", "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)

    with open(f"{args.out}/manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    # thong ke
    counts = {}
    for r in manifest:
        for c in r["categories"] or ["uncategorized"]:
            counts[c] = counts.get(c, 0) + 1
    print(f"Da tach {len(manifest)} bai viet:")
    for c, n in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {c}: {n}")
    total_imgs = sum(len(r["images"]) for r in manifest)
    print(f"Tong URL anh can tai: {total_imgs}")
    print("\nXong buoc 2. Kiem tra manifest.json roi chay: images")


def step_images(args):
    """Buoc 3: tai anh ve, dat trong thu muc category tuong ung."""
    manifest = load(f"{args.out}/manifest.json")
    if args.limit:
        manifest = manifest[: args.limit]

    total = sum(len(r["images"]) for r in manifest)
    if args.dry_run:
        print(f"[DRY-RUN] Se tai {total} anh cho {len(manifest)} bai viet.")
        for r in manifest[:5]:
            print(f"  {r['slug']}: {len(r['images'])} anh")
            for u in r["images"][:3]:
                print(f"    - {u}")
        print("Bo --dry-run de tai that.")
        return

    done, failed = 0, []
    for r in manifest:
        cat = slugify(r["categories"][0]) if r["categories"] else "uncategorized"
        img_dir = os.path.join(args.out, "images", cat, r["slug"][:60])
        os.makedirs(img_dir, exist_ok=True)
        url_map = {}

        for url in r["images"]:
            name = os.path.basename(unquote(urlparse(url).path)) or "image.jpg"
            dest = os.path.join(img_dir, name)
            if os.path.exists(dest):
                url_map[url] = os.path.relpath(dest, args.out)
                done += 1
                continue
            try:
                resp = requests.get(url, headers=UA, timeout=60)
                resp.raise_for_status()
                with open(dest, "wb") as f:
                    f.write(resp.content)
                url_map[url] = os.path.relpath(dest, args.out)
                done += 1
                time.sleep(args.delay)
            except Exception as e:
                failed.append({"post": r["slug"], "url": url, "error": str(e)})
            if done % 25 == 0:
                print(f"  ... {done}/{total} anh")

        r["local_images"] = url_map

    with open(f"{args.out}/manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    if failed:
        with open(f"{args.out}/failed_images.json", "w", encoding="utf-8") as f:
            json.dump(failed, f, ensure_ascii=False, indent=2)

    print(f"Xong: {done}/{total} anh. Loi: {len(failed)} (xem failed_images.json)")


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("step", choices=["meta", "organize", "images"])
    ap.add_argument("--out", default="export")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--per-page", type=int, default=20,
                    help="so muc moi request (giam xuong 10 hoac 5 neu server cham)")
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    {"meta": step_meta, "organize": step_organize, "images": step_images}[args.step](args)


if __name__ == "__main__":
    main()