import http.server
import socketserver

PORT = 8000
DIRECTORY = "/Users/kaisabaab/STAGE/espOTA"  # Change this to your folder with the .bin file

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving HTTP on port {PORT} from directory {DIRECTORY}")
        httpd.serve_forever()
