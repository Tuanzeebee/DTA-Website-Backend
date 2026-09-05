#!/usr/bin/env python3
"""
import_to_postgres.py - Nap du lieu tu thu muc export/ (da lay ve) vao PostgreSQL.

KHONG tai lai gi tu internet - chi doc file co san trong export/.

Ket noi (chon 1 trong 3 cach):
  1) --dsn "postgresql://user:matkhau@localhost:5432/tendb"
  2) bien moi truong DATABASE_URL
  3) tung phan: --host --port --dbname --user --password

Chay:
    python import_to_postgres.py --dsn "postgresql://postgres:123@localhost:5432/dsa"
    python import_to_postgres.py --dbname dsa --user postgres --password 123
    python import_to_postgres.py --dsn "..." --export D:/CloneDataDTA/export
    python import_to_postgres.py --dsn "..." --limit 20      # thu 20 bai truoc

Yeu cau:
    pip install psycopg2-binary
    pip install beautifulsoup4      # chi can neu file .json chua co san 'blocks'

CANH BAO: script DROP roi tao lai 4 bang (categories, posts, post_categories,
blocks) trong schema 'public'. Dung dung database co du lieu khac.
Muon giu rieng thi tao database moi va tro --dbname vao do.

Bang:
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
import sys

try:
    import psycopg2
except ImportError:
    sys.exit("Thieu driver: chay  pip install psycopg2-binary")

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


def clean_ts(value):
    """Chuyen chuoi ngay ISO cua WordPress; rong -> None de PG khoi loi."""
    v = (value or "").strip()
    return v or None


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
DROP TABLE IF EXISTS blocks CASCADE;
DROP TABLE IF EXISTS post_categories CASCADE;
DROP TABLE IF EXISTS posts CASCADE;
DROP TABLE IF EXISTS categories CASCADE;

CREATE TABLE categories (
    id     SERIAL PRIMARY KEY,
    wp_id  INTEGER UNIQUE,
    name   TEXT,
    slug   TEXT
);

CREATE TABLE posts (
    id             SERIAL PRIMARY KEY,
    wp_id          INTEGER UNIQUE,
    slug           TEXT,
    title          TEXT,
    date           TIMESTAMP,
    modified       TIMESTAMP,
    link           TEXT,
    excerpt        TEXT,
    featured_image TEXT
);

CREATE TABLE post_categories (
    post_id     INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, category_id)
);

-- Moi dong = 1 block. position giu THU TU tren trang goc.
--   type='text'  -> dung cot text
--   type='image' -> dung image_url / image_local_path / alt
CREATE TABLE blocks (
    id               SERIAL PRIMARY KEY,
    post_id          INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    position         INTEGER,
    type             TEXT,
    text             TEXT,
    image_url        TEXT,
    image_local_path TEXT,
    alt              TEXT,
    is_featured      BOOLEAN DEFAULT FALSE
);
CREATE INDEX idx_blocks_post ON blocks(post_id, position);
"""


def get_blocks_for(rec, root):
    """Lay chuoi block cho 1 bai: uu tien .json, khong co thi parse tu .html."""
    cf = rec.get("content_file", "")
    html_path = os.path.join(root, cf)
    pjson = html_path[:-5] + ".json" if html_path.endswith(".html") else html_path
    if os.path.exists(pjson):
        blocks = load(pjson).get("blocks", [])
        if blocks:
            return blocks
    if html_path.endswith(".html") and os.path.exists(html_path):
        with open(html_path, encoding="utf-8") as f:
            return build_blocks(f.read(), rec.get("featured_image"), rec.get("title", ""))
    return []


# ---------------------------------------------------------------- import

def connect(args):
    if args.dsn:
        return psycopg2.connect(args.dsn)
    if os.environ.get("DATABASE_URL"):
        return psycopg2.connect(os.environ["DATABASE_URL"])
    if not args.dbname:
        sys.exit("Can --dsn, hoac DATABASE_URL, hoac it nhat --dbname.")
    return psycopg2.connect(
        host=args.host, port=args.port, dbname=args.dbname,
        user=args.user, password=args.password,
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--export", default="export", help="thu muc export (mac dinh ./export)")
    ap.add_argument("--dsn", help='postgresql://user:pass@host:port/db')
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", default="5432")
    ap.add_argument("--dbname")
    ap.add_argument("--user", default="postgres")
    ap.add_argument("--password", default="")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    root = args.export
    for required in ("manifest.json", "categories.json"):
        if not os.path.exists(os.path.join(root, required)):
            sys.exit(f"Khong tim thay {required} trong {root}. Kiem tra lai --export.")

    manifest = load(os.path.join(root, "manifest.json"))
    if args.limit:
        manifest = manifest[: args.limit]

    conn = connect(args)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        cur.execute(SCHEMA)

        # categories
        catid = {}
        for cat in load(os.path.join(root, "categories.json")):
            cur.execute(
                "INSERT INTO categories(wp_id,name,slug) VALUES(%s,%s,%s) RETURNING id",
                (cat["id"], cat["name"], cat.get("slug") or slugify(cat["name"])),
            )
            catid[cat["name"]] = cur.fetchone()[0]

        n_posts = n_blocks = n_local = n_missing = 0
        for rec in manifest:
            cur.execute(
                """INSERT INTO posts
                   (wp_id,slug,title,date,modified,link,excerpt,featured_image)
                   VALUES(%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                (rec.get("id"), rec.get("slug"), rec.get("title"),
                 clean_ts(rec.get("date")), clean_ts(rec.get("modified")),
                 rec.get("link"), rec.get("excerpt"), rec.get("featured_image")),
            )
            post_id = cur.fetchone()[0]
            n_posts += 1

            for cname in rec.get("categories") or []:
                cid = catid.get(cname)
                if cid:
                    cur.execute(
                        "INSERT INTO post_categories(post_id,category_id) "
                        "VALUES(%s,%s) ON CONFLICT DO NOTHING",
                        (post_id, cid),
                    )

            blocks = get_blocks_for(rec, root)
            if not blocks:
                n_missing += 1
            local_map = rec.get("local_images", {})

            for pos, b in enumerate(blocks):
                if b["type"] == "image":
                    url = b.get("src")
                    local = local_map.get(url)
                    if local:
                        n_local += 1
                    cur.execute(
                        """INSERT INTO blocks
                           (post_id,position,type,image_url,image_local_path,alt,is_featured)
                           VALUES(%s,%s,%s,%s,%s,%s,%s)""",
                        (post_id, pos, "image", url, local, b.get("alt"),
                         bool(b.get("featured"))),
                    )
                else:
                    cur.execute(
                        "INSERT INTO blocks(post_id,position,type,text) VALUES(%s,%s,%s,%s)",
                        (post_id, pos, "text", b.get("text")),
                    )
                n_blocks += 1

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    print("Da nap xong vao PostgreSQL.")
    print(f"  posts : {n_posts}")
    print(f"  blocks: {n_blocks}  (anh co file local: {n_local})")
    if n_missing:
        print(f"  ! {n_missing} bai khong tim thay file noi dung -> khong co block")
    if n_local == 0:
        print("  (image_local_path dang trong - manifest chua co 'local_images'.)")
    print("\nLay lai 1 bai dung thu tu block:")
    print("  SELECT position,type,text,image_local_path,is_featured")
    print("  FROM blocks WHERE post_id=1 ORDER BY position;")


if __name__ == "__main__":
    main()
