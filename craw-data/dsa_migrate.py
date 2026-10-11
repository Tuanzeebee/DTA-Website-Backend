#!/usr/bin/env python3
"""
dsa_migrate.py - Rut du lieu tu site WordPress (dsa.org.vn) qua REST API.

Chay theo 3 buoc rieng biet (co checkpoint, khong lam tat ca cung luc):

  1) python dsa_migrate.py meta              -> tai toan bo metadata bai viet (JSON)
  2) python dsa_migrate.py organize          -> tach ra thu muc theo category + file .json/.html
  3) python dsa_migrate.py images            -> tai anh (featured + anh trong noi dung)
     python dsa_migrate.py sync             -> chay ca 3 buoc (khong ghi database)
     python dsa_migrate.py new --previous D:/CloneDataDTA/export
                                            -> chi bai moi, tao exportDD-MM

Tuy chon chung:
  --limit N       chi xu ly N bai dau (de test truoc khi chay full)
  --out DIR       thu muc output (mac dinh: export/ ben canh script)
  --delay SEC     nghi giua cac request (mac dinh 1.0s)
  --per-page N    so muc moi request, mac dinh 20 (giam neu server timeout)
  --timeout SEC   timeout moi request, mac dinh 120s
  --dry-run       chi in ra se lam gi, khong ghi/tai file (chi cho buoc images)
  --refresh-images  tai lai ca anh da co (mac dinh chi tai anh thieu)

Moi lan meta deu quet tu trang 1, gop theo ID WordPress: them bai moi,
cap nhat bai cu, khong tao trung. Luu sau moi trang; chay lai sau loi an toan.

Yeu cau: pip install requests
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime
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


def save_json(path, data):
    """Thay file sau khi ghi xong, tranh mat checkpoint khi bi ngat."""
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(path + ".tmp", path)


def fetch_all(endpoint, out_path, delay, per_page=20, timeout=120, limit=0, exclude_ids=None):
    """Quet lai tu dau de thay bai moi/da sua; gop checkpoint theo ID."""
    items = {item["id"]: item for item in load(out_path)} if os.path.exists(out_path) else {}
    exclude_ids = exclude_ids or set()
    items = {id: item for id, item in items.items() if id not in exclude_ids}
    page, fetched, scanned, added, updated = 1, 0, 0, 0, 0

    while True:
        params = {"per_page": per_page, "page": page, "orderby": "id", "order": "desc"}
        try:
            data, headers = get_json(f"{API}/{endpoint}", params, delay, timeout)
        except requests.HTTPError as e:
            if (page > 1 and e.response is not None and e.response.status_code == 400
                    and e.response.json().get("code") == "rest_post_invalid_page_number"):
                break
            raise
        if not data:
            break
        scanned += len(data)
        data = [item for item in data if item["id"] not in exclude_ids]
        if limit:
            data = data[:limit - fetched]
        for item in data:
            old = items.get(item["id"])
            added += old is None
            updated += old is not None and old != item
            items[item["id"]] = item
        fetched += len(data)
        total_pages = headers.get("X-WP-TotalPages", "?")
        print(f"  {endpoint}: trang {page}/{total_pages} -> kiem tra {scanned}, chon {fetched} muc")

        # ghi sau moi trang: dut giua chung van khong mat du lieu
        save_json(out_path, sorted(items.values(), key=lambda item: item["id"], reverse=True))

        page += 1
        if (limit and fetched >= limit) or (total_pages != "?" and page > int(total_pages)):
            break

    result = sorted(items.values(), key=lambda item: item["id"], reverse=True)
    save_json(out_path, result)
    print(f"  -> moi: {added}, thay doi: {updated}, tong local: {len(result)} ({out_path})")
    return result


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
    posts = fetch_all("posts", f"{args.out}/posts.json", args.delay,
                      per_page=args.per_page, timeout=args.timeout, limit=args.limit,
                      exclude_ids=getattr(args, "exclude_ids", None))
    if args.limit:
        posts = posts[:args.limit]
    print("[1/3] Tai metadata anh dai dien cua cac bai...")
    media_path = os.path.join(args.out, "media.json")
    media = {m["id"]: m for m in load(media_path)} if os.path.exists(media_path) else {}
    ids = sorted({p["featured_media"] for p in posts if p.get("featured_media")})
    for start in range(0, len(ids), 100):
        data, _ = get_json(f"{API}/media", {
            "include": ",".join(map(str, ids[start:start + 100])), "per_page": 100,
        }, args.delay, args.timeout)
        media.update({m["id"]: m for m in data})
        save_json(media_path, list(media.values()))
    save_json(media_path, list(media.values()))
    print("\nXong buoc 1. Kiem tra file JSON roi chay: organize")


def step_organize(args):
    """Buoc 2: tach bai viet ra thu muc theo category."""
    posts = load(f"{args.out}/posts.json")
    cats = {c["id"]: c["name"] for c in load(f"{args.out}/categories.json")}
    media = {m["id"]: m for m in load(f"{args.out}/media.json")}

    if args.limit:
        posts = posts[: args.limit]

    manifest_path = os.path.join(args.out, "manifest.json")
    manifest = {r["id"]: r for r in load(manifest_path)} if os.path.exists(manifest_path) else {}
    added, refreshed = 0, 0
    for p in posts:
        cat_ids = p.get("categories") or []
        cat_name = cats.get(cat_ids[0], "uncategorized") if cat_ids else "uncategorized"
        cat_dir = os.path.join(args.out, "content", slugify(cat_name))
        os.makedirs(cat_dir, exist_ok=True)

        title = unescape(p["title"]["rendered"])
        date = p["date"][:10]
        slug = p["slug"]
        fname = f"{p['id']}_{date}_{slugify(slug)}"

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
        old = manifest.get(p["id"])
        added += old is None
        refreshed += old is not None
        # Giu mapping anh cu khi lam moi noi dung, chi giu file con ton tai.
        record["local_images"] = {
            url: local for url, local in (old or {}).get("local_images", {}).items()
            if url in imgs and os.path.isfile(os.path.join(args.out, local))
            and os.path.getsize(os.path.join(args.out, local)) > 0
        }

        with open(f"{cat_dir}/{fname}.html.tmp", "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(f"{cat_dir}/{fname}.html.tmp", f"{cat_dir}/{fname}.html")
        save_json(f"{cat_dir}/{fname}.json", record)
        manifest[p["id"]] = record

    manifest = sorted(manifest.values(), key=lambda r: r["id"], reverse=True)
    save_json(manifest_path, manifest)

    # thong ke
    counts = {}
    for r in manifest:
        for c in r["categories"] or ["uncategorized"]:
            counts[c] = counts.get(c, 0) + 1
    print(f"Moi: {added}, lam moi: {refreshed}, tong manifest: {len(manifest)} bai viet:")
    for c, n in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {c}: {n}")
    total_imgs = sum(len(r["images"]) for r in manifest)
    print(f"Tong URL anh can tai: {total_imgs}")
    print("\nXong buoc 2. Kiem tra manifest.json roi chay: images")


def step_images(args):
    """Buoc 3: tai anh ve, dat trong thu muc category tuong ung."""
    manifest_path = os.path.join(args.out, "manifest.json")
    manifest = load(manifest_path)
    selected = manifest[:args.limit] if args.limit else manifest

    total = sum(len(r["images"]) for r in selected)
    if args.dry_run:
        print(f"[DRY-RUN] Se kiem tra {total} anh cho {len(selected)} bai viet.")
        for r in selected[:5]:
            print(f"  {r['slug']}: {len(r['images'])} anh")
            for u in r["images"][:3]:
                print(f"    - {u}")
        print("Bo --dry-run de tai that.")
        return

    done, cached, failed = 0, 0, []
    for r in selected:
        cat = slugify(r["categories"][0]) if r["categories"] else "uncategorized"
        img_dir = os.path.join(args.out, "images", cat, f"{r['id']}-{slugify(r['slug'], 60)}")
        os.makedirs(img_dir, exist_ok=True)
        url_map = {}

        image_names = [os.path.basename(unquote(urlparse(url).path)) or "image.jpg"
                       for url in r["images"]]
        for url, name in zip(r["images"], image_names):
            legacy_dest = os.path.join(args.out, "images", cat, os.path.basename(r["slug"][:60]), name)
            legacy_unique = image_names.count(name) == 1
            name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name)[:120]
            name = hashlib.sha256(url.encode()).hexdigest()[:12] + "-" + name
            dest = os.path.join(img_dir, name)
            previous = r.get("local_images", {}).get(url)
            if previous and os.path.isfile(os.path.join(args.out, previous)):
                dest = os.path.join(args.out, previous)
            elif (legacy_unique and os.path.isfile(legacy_dest)
                  and os.path.getsize(legacy_dest) > 0):
                # Export cu co the da tai anh nhung chua luu local_images.
                dest = legacy_dest
            if os.path.isfile(dest) and os.path.getsize(dest) > 0 and not args.refresh_images:
                url_map[url] = os.path.relpath(dest, args.out)
                done += 1
                cached += 1
                continue
            try:
                resp = requests.get(url, headers=UA, timeout=60)
                resp.raise_for_status()
                if not resp.content:
                    raise ValueError("Anh rong")
                with open(dest + ".tmp", "wb") as f:
                    f.write(resp.content)
                os.replace(dest + ".tmp", dest)
                url_map[url] = os.path.relpath(dest, args.out)
                done += 1
                time.sleep(args.delay)
            except Exception as e:
                failed.append({"post": r["slug"], "url": url, "error": str(e)})
                if os.path.isfile(dest) and os.path.getsize(dest) > 0:
                    url_map[url] = os.path.relpath(dest, args.out)
            if done % 25 == 0:
                print(f"  ... {done}/{total} anh")

        r["local_images"] = url_map
        save_json(manifest_path, manifest)

    save_json(manifest_path, manifest)
    save_json(os.path.join(args.out, "failed_images.json"), failed)

    print(f"Xong: {done}/{total} anh (da co: {cached}). Loi: {len(failed)} (xem failed_images.json)")
    if failed:
        raise RuntimeError("Con anh tai loi. Chay lai images truoc khi import vao DB.")


def step_sync(args):
    step_meta(args)
    step_organize(args)
    step_images(args)


def step_new(args):
    """Tao bo import doc lap chi co bai chua co trong cac export truoc."""
    previous = [os.path.realpath(root) for root in args.previous]
    out = os.path.realpath(args.out)
    known = set()
    for root in previous:
        if (os.path.splitdrive(root)[0].lower() == os.path.splitdrive(out)[0].lower()
                and os.path.commonpath([root, out]) in (root, out)):
            raise ValueError("Thu muc output phai tach rieng thu muc export cu.")
        known.update(r["id"] for r in load(os.path.join(root, "manifest.json")))

    batch_path = os.path.join(args.out, "batch.json")
    if os.path.isdir(args.out) and os.listdir(args.out):
        if not os.path.isfile(batch_path) or load(batch_path).get("previous") != previous:
            raise ValueError("Output da co du lieu khac. Chon thu muc moi bang --out.")
    os.makedirs(args.out, exist_ok=True)
    batch = {"type": "new-articles", "previous": previous, "ready": False}
    save_json(batch_path, batch)
    args.exclude_ids = known
    print(f"Da co {len(known)} ID bai viet. Chi xuat bai moi vao {args.out}")
    step_sync(args)
    manifest = load(os.path.join(args.out, "manifest.json"))
    batch.update(ready=True, count=len(manifest), ids=[r["id"] for r in manifest])
    save_json(batch_path, batch)
    print(f"\nBo import san sang: {args.out} ({len(manifest)} bai moi).")


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("step", choices=["meta", "organize", "images", "sync", "new"])
    ap.add_argument("--out", default=None)
    ap.add_argument("--previous", nargs="+", help="cac thu muc export da cao (bat buoc voi new)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--per-page", type=int, default=20,
                    help="so muc moi request (giam xuong 10 hoac 5 neu server cham)")
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--refresh-images", action="store_true")
    args = ap.parse_args()
    if args.step == "new" and not args.previous:
        ap.error("Buoc new can --previous tro toi thu muc export cu")
    if args.step != "new" and args.previous:
        ap.error("--previous chi dung cho buoc new")
    if args.out is None:
        folder = "export" + datetime.now().strftime("%d-%m") if args.step == "new" else "export"
        args.out = os.path.join(os.path.dirname(os.path.abspath(__file__)), folder)
    if args.limit < 0 or not 1 <= args.per_page <= 100 or args.delay < 0 or args.timeout <= 0:
        ap.error("Can limit >= 0, per-page tu 1 den 100, delay >= 0 va timeout > 0")
    if args.dry_run and args.step != "images":
        ap.error("--dry-run chi dung cho buoc images")

    {"meta": step_meta, "organize": step_organize, "images": step_images,
     "sync": step_sync, "new": step_new}[args.step](args)


if __name__ == "__main__":
    main()
