#!/usr/bin/env python3
"""
import_to_db.py - Nap du lieu tu thu muc export/ (da lay ve) vao SQLite.

KHONG tai lai gi tu internet - chi doc file co san trong export/.

Chay:
    python import_to_db.py                 # doc ./export, tao ./export/dsa.db
    python import_to_db.py --export D:/CloneDataDTA/export
    python import_to_db.py --db out.db     # doi ten file db
    python import_to_db.py --limit 20      # thu 20 bai dau

Yeu cau: pip install beautifulsoup4   (chi can neu file .json chua co san 'blocks')

Bang trong DB:
    categories(id, wp_id, name, slug)
    posts(id, wp_id, slug, title, date, modified, link, excerpt, featured_image)
    post_categories(post_id, category_id)          -- 1 bai thuoc nhieu category
    blocks(id, post_id, position, type, text,       -- position giu THU TU trang goc
           image_url, image_local_path, alt, is_featured)
"""

import argparse
import json
import os
import re
import sqlite3
import sys

try:
    from bs4 import BeautifulSoup, NavigableString
except ImportError:
    BeautifulSoup = None  # chi can khi phai parse tu .html


# ---------------------------------------------------------------- helpers

def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def slugify(text, maxlen=80):
    table = str.maketrans(
        "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợ"
        "ùúủũụưừứửữựỳýỷỹỵđ",
        "aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooo"
        "uuuuuuuuuuuyyyyyd",
    )
    text = text.lower().translate(table)
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")[:maxlen] or "khong-ten"


BLOCK_TAGS = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6",
              "blockquote", "td", "tr", "section", "article", "figure"}


def parse_blocks(html):
    """Tach HTML thanh chuoi block (text/image) theo dung thu tu doc tren trang."""
    if BeautifulSoup is None:
        sys.exit("Thieu thu vien: chay  pip install beautifulsoup4")
    soup = BeautifulSoup(html or "", "html.parser")
    blocks, buf, last_parent = [], [], [None]

    def nearest_block(node):
        p = node.parent
        while p is not None:
            if getattr(p, "name", None) in BLOCK_TAGS:
                return p
            p = p.parent
        return None

    def flush():
        if buf:
            text = "\n\n".join(seg for seg in buf if seg).strip()
            if text:
                blocks.append({"type": "text", "text": text})
            buf.clear()

    for node in soup.descendants:
        if isinstance(node, NavigableString):
            if node.find_parent(["script", "style", "noscript"]):
                continue
            s = " ".join(str(node).split())
            if not s:
                continue
            bp = id(nearest_block(node))
            if buf and bp == last_parent[0]:
                buf[-1] = (buf[-1] + " " + s).strip()
            else:
                buf.append(s)
            last_parent[0] = bp
        elif getattr(node, "name", None) == "img":
            flush()
            src = node.get("src") or node.get("data-src") or node.get("data-lazy-src")
            if src and src.startswith("http"):
                blocks.append({"type": "image", "src": src, "alt": node.get("alt", "") or ""})
            last_parent[0] = None

    flush()
    return blocks


def build_blocks(html, featured=None, title=""):
    blocks = parse_blocks(html)
    body = {b["src"] for b in blocks if b["type"] == "image"}
    if featured and featured not in body:
        blocks.insert(0, {"type": "image", "src": featured, "alt": title, "featured": True})
    return blocks


SCHEMA = """
DROP TABLE IF EXISTS blocks;
DROP TABLE IF EXISTS post_categories;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS categories;

CREATE TABLE categories (
    id INTEGER PRIMARY KEY, wp_id INTEGER UNIQUE, name TEXT, slug TEXT
);
CREATE TABLE posts (
    id INTEGER PRIMARY KEY, wp_id INTEGER UNIQUE, slug TEXT, title TEXT,
    date TEXT, modified TEXT, link TEXT, excerpt TEXT, featured_image TEXT
);
CREATE TABLE post_categories (
    post_id INTEGER REFERENCES posts(id),
    category_id INTEGER REFERENCES categories(id),
    PRIMARY KEY (post_id, category_id)
);
CREATE TABLE blocks (
    id INTEGER PRIMARY KEY,
    post_id INTEGER REFERENCES posts(id),
    position INTEGER,
    type TEXT,                -- 'text' | 'image'
    text TEXT,                -- dung khi type='text'
    image_url TEXT,           -- URL goc
    image_local_path TEXT,    -- file da tai ve (neu co)
    alt TEXT,
    is_featured INTEGER DEFAULT 0
);
CREATE INDEX idx_blocks_post ON blocks(post_id, position);
"""


# ---------------------------------------------------------------- import

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--export", default="export", help="thu muc export (mac dinh ./export)")
    ap.add_argument("--db", default=None, help="duong dan file .db (mac dinh <export>/dsa.db)")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    root = args.export
    db_path = args.db or os.path.join(root, "dsa.db")

    for required in ("manifest.json", "categories.json"):
        if not os.path.exists(os.path.join(root, required)):
            sys.exit(f"Khong tim thay {required} trong {root}. Kiem tra lai --export.")

    manifest = load(os.path.join(root, "manifest.json"))
    if args.limit:
        manifest = manifest[: args.limit]

    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.executescript(SCHEMA)

    # categories
    catid = {}
    for cat in load(os.path.join(root, "categories.json")):
        c.execute("INSERT INTO categories(wp_id,name,slug) VALUES(?,?,?)",
                  (cat["id"], cat["name"], cat.get("slug") or slugify(cat["name"])))
        catid[cat["name"]] = c.lastrowid

    n_posts = n_blocks = n_local = n_missing_html = 0
    for rec in manifest:
        c.execute("""INSERT INTO posts
            (wp_id,slug,title,date,modified,link,excerpt,featured_image)
            VALUES(?,?,?,?,?,?,?,?)""",
                  (rec.get("id"), rec.get("slug"), rec.get("title"), rec.get("date"),
                   rec.get("modified"), rec.get("link"), rec.get("excerpt"),
                   rec.get("featured_image")))
        post_id = c.lastrowid
        n_posts += 1

        for cname in rec.get("categories") or []:
            cid = catid.get(cname)
            if cid:
                c.execute("INSERT OR IGNORE INTO post_categories(post_id,category_id) VALUES(?,?)",
                          (post_id, cid))

        # lay blocks: uu tien tu file .json cua bai; neu chua co thi parse tu .html
        blocks = []
        cf = rec.get("content_file", "")
        html_path = os.path.join(root, cf)
        pjson = html_path[:-5] + ".json" if html_path.endswith(".html") else html_path
        if os.path.exists(pjson):
            blocks = load(pjson).get("blocks", [])
        if not blocks:
            if os.path.exists(html_path) and html_path.endswith(".html"):
                with open(html_path, encoding="utf-8") as f:
                    blocks = build_blocks(f.read(), rec.get("featured_image"), rec.get("title", ""))
            else:
                n_missing_html += 1

        local_map = rec.get("local_images", {})
        for pos, b in enumerate(blocks):
            if b["type"] == "image":
                url = b.get("src")
                local = local_map.get(url)
                if local:
                    n_local += 1
                c.execute("""INSERT INTO blocks
                    (post_id,position,type,image_url,image_local_path,alt,is_featured)
                    VALUES(?,?,?,?,?,?,?)""",
                          (post_id, pos, "image", url, local, b.get("alt"),
                           1 if b.get("featured") else 0))
            else:
                c.execute("INSERT INTO blocks(post_id,position,type,text) VALUES(?,?,?,?)",
                          (post_id, pos, "text", b.get("text")))
            n_blocks += 1

    conn.commit()

    # thong ke nhanh
    cat_counts = list(c.execute("""
        SELECT cat.name, COUNT(*) FROM post_categories pc
        JOIN categories cat ON cat.id = pc.category_id
        GROUP BY cat.name ORDER BY COUNT(*) DESC"""))
    conn.close()

    print(f"Da nap vao: {db_path}")
    print(f"  posts : {n_posts}")
    print(f"  blocks: {n_blocks}  (anh co file local: {n_local})")
    if n_missing_html:
        print(f"  ! {n_missing_html} bai khong tim thay file noi dung -> khong co block")
    print("  So bai theo category:")
    for name, n in cat_counts:
        print(f"    {name}: {n}")
    if n_local == 0:
        print("\n  (image_local_path dang trong - manifest chua co 'local_images'."
              " Neu da tai anh thi kiem tra lai buoc images.)")
    print("\nLay lai 1 bai dung thu tu block:")
    print("  SELECT position,type,text,image_local_path,is_featured")
    print("  FROM blocks WHERE post_id=1 ORDER BY position;")


if __name__ == "__main__":
    main()
