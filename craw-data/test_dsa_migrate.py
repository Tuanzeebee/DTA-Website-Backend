import json
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import requests

import dsa_migrate as crawler


class CrawlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = self.temp.name
        self.args = SimpleNamespace(
            out=self.root, limit=0, delay=0, per_page=2, timeout=1,
            dry_run=False, refresh_images=False,
        )

    def save(self, name, data):
        crawler.save_json(os.path.join(self.root, name), data)

    def write(self, name, data):
        path = os.path.join(self.root, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        return path

    def post(self, id, slug="bai-viet"):
        return {
            "id": id, "slug": slug, "date": "2026-10-11T12:00:00",
            "modified": "2026-10-11T13:00:00", "link": f"https://dsa.org.vn/{slug}/",
            "title": {"rendered": "Bài mới"}, "content": {"rendered": "<p>Nội dung mới</p>"},
            "excerpt": {"rendered": "<p>Mô tả</p>"}, "categories": [1], "featured_media": 10,
        }

    def test_refresh_merges_ids_and_resumes_after_interruption(self):
        self.save("posts.json", [{"id": 1, "title": "old"}, {"id": 1, "title": "duplicate"}])
        pages = [([{"id": 3}, {"id": 2}], {"X-WP-TotalPages": "2"}), RuntimeError("offline")]
        path = os.path.join(self.root, "posts.json")
        with patch.object(crawler, "get_json", side_effect=pages):
            with self.assertRaises(RuntimeError):
                crawler.fetch_all("posts", path, 0, per_page=2)
        self.assertEqual([p["id"] for p in crawler.load(path)], [3, 2, 1])

        pages = [([{"id": 3}, {"id": 2}], {"X-WP-TotalPages": "2"}),
                 ([{"id": 1, "title": "updated"}], {"X-WP-TotalPages": "2"})]
        with patch.object(crawler, "get_json", side_effect=pages * 2) as get:
            for _ in range(2):
                posts = crawler.fetch_all("posts", path, 0, per_page=2)
            self.assertEqual(get.call_args_list[0].args[1]["page"], 1)
        self.assertEqual(len(posts), 3)
        self.assertEqual(posts[-1]["title"], "updated")

    def test_http_404_is_not_reported_as_success(self):
        response = requests.Response()
        response.status_code = 404
        with patch.object(crawler, "get_json", side_effect=requests.HTTPError(response=response)):
            with self.assertRaises(requests.HTTPError):
                crawler.fetch_all("posts", os.path.join(self.root, "posts.json"), 0)

    def test_organize_preserves_images_and_other_posts_with_limit(self):
        url = "https://dsa.org.vn/photo.jpg"
        self.write("images/old/photo.jpg", b"old photo")
        self.save("posts.json", [self.post(2, "doi-slug"), self.post(1)])
        self.save("categories.json", [{"id": 1, "name": "Sự kiện"}])
        self.save("media.json", [{"id": 10, "source_url": url}])
        self.save("manifest.json", [
            {"id": 2, "local_images": {url: "images/old/photo.jpg", "missing": "missing.jpg"}},
            {"id": 1, "slug": "untouched", "categories": [], "images": []},
        ])
        self.args.limit = 1
        crawler.step_organize(self.args)
        manifest = crawler.load(os.path.join(self.root, "manifest.json"))
        self.assertEqual(len(manifest), 2)
        self.assertEqual(manifest[1]["slug"], "untouched")
        self.assertEqual(manifest[0]["local_images"], {url: "images/old/photo.jpg"})
        self.assertEqual(manifest[0]["slug"], "doi-slug")
        self.assertIn("2_", manifest[0]["content_file"])
        with open(os.path.join(self.root, manifest[0]["content_file"]), encoding="utf-8") as f:
            self.assertEqual(f.read(), "<p>Nội dung mới</p>")

    def test_images_only_download_missing_and_keep_unselected_records(self):
        cached = "https://dsa.org.vn/cached.jpg"
        # Two URLs with the same basename must get different local files.
        urls = ["https://dsa.org.vn/a/photo.jpg", "https://dsa.org.vn/b/photo.jpg"]
        self.write("images/old/cached.jpg", b"cached")
        self.write("images/uncategorized/test/photo.jpg", b"ambiguous legacy")
        self.save("manifest.json", [
            {"id": 2, "slug": "test", "categories": [], "images": [cached] + urls,
             "local_images": {cached: "images/old/cached.jpg"}},
            {"id": 1, "slug": "untouched", "categories": [], "images": ["https://other/image.jpg"]},
        ])
        self.args.limit = 1
        response = SimpleNamespace(content=b"downloaded", raise_for_status=lambda: None)
        with patch.object(crawler.requests, "get", return_value=response) as get:
            crawler.step_images(self.args)
            self.assertEqual(get.call_count, 2)
            crawler.step_images(self.args)
            self.assertEqual(get.call_count, 2)
        manifest = crawler.load(os.path.join(self.root, "manifest.json"))
        mapping = manifest[0]["local_images"]
        self.assertEqual(len(manifest), 2)
        self.assertEqual(mapping[cached], os.path.normpath("images/old/cached.jpg"))
        self.assertNotEqual(mapping[urls[0]], mapping[urls[1]])
        self.assertNotIn("local_images", manifest[1])

    def test_failed_refresh_keeps_good_image_and_retry_clears_error(self):
        url = "https://dsa.org.vn/photo.jpg"
        path = self.write("images/old/photo.jpg", b"good image")
        self.save("manifest.json", [{
            "id": 1, "slug": "test", "categories": [], "images": [url],
            "local_images": {url: "images/old/photo.jpg"},
        }])
        self.args.refresh_images = True
        with patch.object(crawler.requests, "get", side_effect=requests.Timeout("timeout")):
            with self.assertRaises(RuntimeError):
                crawler.step_images(self.args)
        with open(path, "rb") as f:
            self.assertEqual(f.read(), b"good image")
        manifest = crawler.load(os.path.join(self.root, "manifest.json"))
        self.assertIn(url, manifest[0]["local_images"])
        self.assertEqual(len(crawler.load(os.path.join(self.root, "failed_images.json"))), 1)
        response = SimpleNamespace(content=b"refreshed", raise_for_status=lambda: None)
        with patch.object(crawler.requests, "get", return_value=response):
            crawler.step_images(self.args)
        self.assertEqual(crawler.load(os.path.join(self.root, "failed_images.json")), [])
        with open(path, "rb") as f:
            self.assertEqual(f.read(), b"refreshed")

    def test_images_reuse_legacy_download_without_mapping(self):
        url = "https://dsa.org.vn/photo.jpg"
        self.write("images/uncategorized/test/photo.jpg", b"legacy")
        self.save("manifest.json", [{
            "id": 1, "slug": "test", "categories": [], "images": [url],
        }])
        with patch.object(crawler.requests, "get") as get:
            crawler.step_images(self.args)
            get.assert_not_called()
        mapping = crawler.load(os.path.join(self.root, "manifest.json"))[0]["local_images"]
        self.assertEqual(mapping[url], os.path.normpath("images/uncategorized/test/photo.jpg"))

    def prepare_new_batch(self):
        previous = os.path.join(self.root, "previous")
        os.makedirs(previous)
        crawler.save_json(os.path.join(previous, "manifest.json"), [{"id": 1}, {"id": 3}])
        self.args.previous = [previous]
        self.args.out = os.path.join(self.root, "export11-10")

        def api(url, params, *_):
            if url.endswith("/categories"):
                return [{"id": 1, "name": "Sự kiện"}], {"X-WP-TotalPages": "1"}
            if url.endswith("/media"):
                return [], {}
            ids = [4, 3] if params["page"] == 1 else [2, 1]
            return [self.post(id, f"bai-{id}") for id in ids], {"X-WP-TotalPages": "2"}

        return previous, api

    def test_new_batch_has_only_unknown_ids_and_never_modifies_previous(self):
        previous, api = self.prepare_new_batch()
        previous_path = os.path.join(previous, "manifest.json")
        with open(previous_path, "rb") as f:
            before = f.read()
        with patch.object(crawler, "get_json", side_effect=api):
            crawler.step_new(self.args)
            crawler.step_new(self.args)
        manifest = crawler.load(os.path.join(self.args.out, "manifest.json"))
        self.assertEqual([r["id"] for r in manifest], [4, 2])
        self.assertEqual(crawler.load(os.path.join(self.args.out, "batch.json"))["ready"], True)
        with open(previous_path, "rb") as f:
            self.assertEqual(f.read(), before)

    def test_failed_new_batch_remains_not_ready_for_import(self):
        _, api = self.prepare_new_batch()
        with patch.object(crawler, "get_json", side_effect=api), \
                patch.object(crawler, "step_images", side_effect=RuntimeError("offline")):
            with self.assertRaises(RuntimeError):
                crawler.step_new(self.args)
        self.assertFalse(crawler.load(os.path.join(self.args.out, "batch.json"))["ready"])

    def test_new_batch_rejects_output_inside_previous(self):
        previous, _ = self.prepare_new_batch()
        self.args.out = os.path.join(previous, "nested")
        with self.assertRaises(ValueError):
            crawler.step_new(self.args)
        self.assertFalse(os.path.exists(self.args.out))


if __name__ == "__main__":
    unittest.main()
