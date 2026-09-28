"""THROWAWAY UI prototype. Serve real report data read-only on localhost.

Run: python prototype/collaborative_report_prototype.py
"""

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


REPORT_ROOT = Path(r"D:\pam\20_weekly_report\2026")
DEFAULT_REPORT = REPORT_ROOT / "0924/CIM3_WeeklyReport_260924.json"
DEFAULT_PREVIOUS = REPORT_ROOT / "0918/CIM3_WeeklyReport_260918.json"
HTML = Path(__file__).with_suffix(".html")


def main():
    parser = argparse.ArgumentParser(description="Throwaway weekly report layout prototype")
    parser.add_argument("--report-json", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--previous-json", type=Path, default=DEFAULT_PREVIOUS)
    parser.add_argument("--port", type=int, default=8091)
    args = parser.parse_args()

    current = json.loads(args.report_json.read_text(encoding="utf-8-sig"))
    previous = (
        json.loads(args.previous_json.read_text(encoding="utf-8-sig"))
        if args.previous_json.exists()
        else None
    )
    payload = json.dumps({"current": current, "previous": previous}, ensure_ascii=False).encode("utf-8")
    html = HTML.read_bytes()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlparse(self.path).path
            if path in ("/", "/prototype/weekly-report"):
                content, content_type = html, "text/html; charset=utf-8"
            elif path == "/api/data":
                content, content_type = payload, "application/json; charset=utf-8"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(content)

    url = f"http://127.0.0.1:{args.port}/prototype/weekly-report"
    print(f"Throwaway prototype: {url}", flush=True)
    print("Data stays in memory; Ctrl+C stops the server.", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
