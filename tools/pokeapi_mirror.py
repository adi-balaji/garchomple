"""Serve a local checkout of github.com/PokeAPI/api-data as if it were pokeapi.co.

Only needed when pokeapi.co is unreachable. Usage:
    python3 pokeapi_mirror.py /path/to/api-data/data 8642
then run build_data.py with POKEAPI_BASE=http://127.0.0.1:8642/api/v2
"""
import http.server, os, sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "api-data/data")
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8642

class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = path.split("?", 1)[0].strip("/")
        return os.path.join(ROOT, path, "index.json")
    def log_message(self, *a):
        pass

http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
