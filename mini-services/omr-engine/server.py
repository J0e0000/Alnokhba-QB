# ALNOKHBA QB — OMR Engine HTTP service (stdlib only, port 3032)
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine.pipeline import ocr, process  # noqa: E402

PORT = 3032
MAX_BODY = 25 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            self._send(200, {"ok": True, "engine": "python-opencv", "version": "1.0.0"})
        else:
            self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self):  # noqa: N802
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_BODY:
                self._send(413, {"ok": False, "error": "payload too large"})
                return
            raw = self.rfile.read(length)
            payload = json.loads(raw.decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            self._send(400, {"ok": False, "error": f"invalid JSON body: {e}"})
            return

        try:
            if self.path == "/process":
                result = process(payload)
                self._send(200, result)
            elif self.path == "/ocr":
                result = ocr(payload.get("imageBase64", ""), payload.get("lang", "eng"))
                self._send(200, result)
            else:
                self._send(404, {"ok": False, "error": "not found"})
        except Exception as e:  # noqa: BLE001
            import traceback

            traceback.print_exc()
            self._send(200, {"ok": False, "stage": "unhandled", "error": f"internal error: {e}"})

    def log_message(self, fmt, *args):  # quiet-ish
        sys.stderr.write("[omr-engine] " + (fmt % args) + "\n")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[omr-engine] listening on http://127.0.0.1:{PORT}", flush=True)
    server.serve_forever()
