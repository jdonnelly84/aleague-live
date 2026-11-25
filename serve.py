"""Serve A-League Live from this folder.

    python serve.py            -> http://localhost:8765 (this PC only)
    python serve.py --phone    -> also reachable from a phone on the same Wi-Fi

The app itself reads the A-Leagues data feed straight from the phone/browser,
so this server only hands out the app's own files.
"""
import http.server
import os
import socket
import sys

PORT = int(os.environ.get('PORT', '8765'))
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.webmanifest': 'application/manifest+json',
        '.svg': 'image/svg+xml',
        '.js': 'text/javascript',
    }

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


if __name__ == '__main__':
    phone = '--phone' in sys.argv
    host = '0.0.0.0' if phone else '127.0.0.1'
    httpd = http.server.ThreadingHTTPServer((host, PORT), Handler)
    print(f'A-League Live running at http://localhost:{PORT}')
    if phone:
        print(f'On your phone (same Wi-Fi) open:  http://{lan_ip()}:{PORT}')
    print('Press Ctrl+C to stop.')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
