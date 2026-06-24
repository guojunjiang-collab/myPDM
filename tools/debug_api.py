import json, urllib.request, ssl, urllib.parse
ssl._create_default_https_context = ssl._create_unverified_context

class HTTPSRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if newurl.startswith("http://"):
            newurl = "https://" + newurl[7:]
        return urllib.request.HTTPRedirectHandler.redirect_request(self, req, fp, code, msg, headers, newurl)

opener = urllib.request.build_opener(HTTPSRedirectHandler)
urllib.request.install_opener(opener)

def api(method, path, body=None, token=None):
    url = "https://localhost:8080/api" + path
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return {"ok": True, "code": resp.status, "data": json.loads(resp.read())}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            body = json.loads(raw)
        except:
            body = raw
        return {"ok": False, "code": e.code, "body": body}

def api_form(path, fields, token=None):
    url = "https://localhost:8080/api" + path
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return {"ok": True, "code": resp.status, "data": json.loads(resp.read())}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            body = json.loads(raw)
        except:
            body = raw
        return {"ok": False, "code": e.code, "body": body}

eng = api_form("/auth/token", {"username": "eng", "password": "123456"})
ENG = eng["data"]["access_token"]
print("Token: " + ENG[:30])

# Test project creation
r = api("POST", "/projects", {
    "name": "Test Debug Project",
    "status": "in_progress",
    "planned_start": "2026-06-01",
    "planned_end": "2026-12-31",
    "description": "Debug test"
}, token=ENG)
print("\nCreate project:")
print(json.dumps(r, indent=2, ensure_ascii=False, default=str)[:500])

# Test list projects
r2 = api("GET", "/projects/", token=ENG)
print("\nList projects:")
d = r2.get("data", {})
if isinstance(d, dict):
    print("type: dict, keys:", list(d.keys())[:5])
    if "items" in d:
        print("items count:", len(d["items"]))
        for i in d["items"][:2]:
            print("  ", i.get("code"), i.get("name"))
elif isinstance(d, list):
    print("type: list, count:", len(d))
    for i in d[:2]:
        print("  ", i.get("code"), i.get("name"))

# Test parts
r3 = api("GET", "/parts/?page_size=5", token=ENG)
print("\nParts:")
d3 = r3.get("data", {})
if isinstance(d3, dict):
    print("type: dict, keys:", list(d3.keys())[:5])
    if "items" in d3:
        print("items count:", len(d3["items"]))
elif isinstance(d3, list):
    print("type: list, count:", len(d3))
