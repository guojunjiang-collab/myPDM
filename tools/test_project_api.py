import json, urllib.request, ssl, urllib.parse, sys

ssl._create_default_https_context = ssl._create_unverified_context

class HTTPSRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if newurl.startswith("http://"):
            newurl = "https://" + newurl[7:]
        return urllib.request.HTTPRedirectHandler.redirect_request(self, req, fp, code, msg, headers, newurl)

urllib.request.install_opener(urllib.request.build_opener(HTTPSRedirectHandler))

def api(method, path, body=None, token=None):
    url = "https://localhost:8080/api" + path
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return {"__error__": True, "code": e.code, "body": raw}

def api_form(path, fields, token=None):
    url = "https://localhost:8080/api" + path
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return {"__error__": True, "code": e.code, "body": raw}

def ok(r):
    return not (isinstance(r, dict) and r.get("__error__"))

def get_items(r):
    if isinstance(r, list):
        return r
    if isinstance(r, dict):
        return r.get("items", [])
    return []

passed = 0
failed = 0

def check(condition, label):
    global passed, failed
    if condition:
        passed += 1
        print("  PASS: " + label)
    else:
        failed += 1
        print("  FAIL: " + label)
    return condition

def section(title):
    print("\n" + "=" * 8 + " " + title + " " + "=" * 8)

# ==== Tokens ====
section("Tokens")
ENG = api_form("/auth/token", {"username": "eng", "password": "123456"})["access_token"]
PROD = api_form("/auth/token", {"username": "product", "password": "123456"})["access_token"]
GUEST = api_form("/auth/token", {"username": "guest", "password": "123456"})["access_token"]
check(True, "engineer login")
check(True, "production login")
check(True, "guest login")

# Get IDs
users = api("GET", "/users/?skip=0&limit=50", token=ENG)
PROD_UID = GUEST_UID = None
for u in (users if isinstance(users, list) else []):
    if u["username"] == "product":
        PROD_UID = u["id"]
    if u["username"] == "guest":
        GUEST_UID = u["id"]
check(PROD_UID is not None, "found production user")
check(GUEST_UID is not None, "found guest user")

# ==== Create project ====
section("Create project")
proj = api("POST", "/projects", {
    "name": "Test Project X300",
    "planned_start": "2026-06-01",
    "planned_end": "2026-12-31",
    "description": "Integration test"
}, token=ENG)
PROJ_ID = proj["id"]
check(ok(proj), "project created")
check(proj["code"].startswith("PRJ-"), "code: " + proj["code"])
check(len(proj.get("members", [])) >= 1, "members: " + str(len(proj.get("members", []))))

# ==== List (engineer) ====
section("List projects")
lst = api("GET", "/projects", token=ENG)
items = get_items(lst)
check(any(i["id"] == PROJ_ID for i in items), "engineer sees own project")

# ==== List (production, not member) ====
lst2 = api("GET", "/projects", token=PROD)
items2 = get_items(lst2)
check(len(items2) == 0, "production sees 0 projects")

# ==== List (guest) ====
lst3 = api("GET", "/projects", token=GUEST)
items3 = get_items(lst3)
check(len(items3) == 0, "guest sees 0 projects")

# ==== Add member ====
section("Add member")
member_url = "/projects/" + PROJ_ID + "/members"
add_m = api("POST", member_url, {"user_id": PROD_UID, "role_in_project": "\u6210\u5458"}, token=ENG)
check(ok(add_m) and add_m.get("role_in_project") == "\u6210\u5458", "member added")

# ==== Production sees project ====
lst4 = api("GET", "/projects", token=PROD)
items4 = get_items(lst4)
check(any(i["id"] == PROJ_ID for i in items4), "production sees project")

# ==== Guest still can't ====
lst5 = api("GET", "/projects", token=GUEST)
items5 = get_items(lst5)
check(len(items5) == 0, "guest still sees 0")

# ==== Create task tree ====
section("Task tree")
tasks_url = "/projects/" + PROJ_ID + "/tasks"
root = api("POST", tasks_url, {
    "name": "Design Phase",
    "task_type": "\u91cc\u7a0b\u7891",
    "priority": "\u9ad8",
    "planned_end": "2026-03-01"
}, token=ENG)
ROOT_ID = root["id"]
check(ok(root), "root milestone created")

child1 = api("POST", tasks_url, {
    "name": "Mechanical Design",
    "parent_id": ROOT_ID,
    "assignee_id": PROD_UID,
    "planned_end": "2026-05-01"
}, token=ENG)
CHILD1_ID = child1["id"]
check(ok(child1) and child1.get("parent_id") == ROOT_ID, "child1 created")

child2 = api("POST", tasks_url, {
    "name": "Electrical Design",
    "parent_id": ROOT_ID,
    "priority": "\u9ad8",
    "planned_end": "2026-04-15"
}, token=ENG)
CHILD2_ID = child2["id"]
check(ok(child2), "child2 created")

grand = api("POST", tasks_url, {
    "name": "BOM Build",
    "parent_id": CHILD1_ID,
    "planned_end": "2025-12-01"
}, token=ENG)
GRAND_ID = grand["id"]
check(ok(grand) and grand.get("parent_id") == CHILD1_ID, "grandchild created")

# ==== Tree structure ====
section("Tree structure")
tree = api("GET", tasks_url, token=ENG)
roots = get_items(tree)
check(len(roots) >= 1, "tree has roots")
if roots:
    r = roots[0]
    check(len(r.get("children", [])) == 2, "root has 2 children")
    from datetime import date
    today = str(date.today())
    for c in r.get("children", []):
        for gc in c.get("children", []):
            if gc.get("planned_end") and gc["planned_end"] < today:
                print("  INFO: " + gc["name"] + " is OVERDUE")

# ==== Status update ====
section("Status update")
status_url = "/projects/" + PROJ_ID + "/tasks/" + CHILD1_ID + "/status"
status = api("PATCH", status_url, {"status": "\u8fdb\u884c\u4e2d"}, token=PROD)
check(ok(status) and status.get("status") == "\u8fdb\u884c\u4e2d", "production updated status")

# ==== Edit task ====
section("Edit task")
edit_url = "/projects/" + PROJ_ID + "/tasks/" + ROOT_ID
edit = api("PUT", edit_url, {"name": "Design Phase v2", "task_type": "\u8bc4\u5ba1"}, token=ENG)
check(ok(edit) and edit["name"] == "Design Phase v2" and edit["task_type"] == "\u8bc4\u5ba1", "task edited")

# ==== Links ====
section("Task links")
links_url = "/projects/" + PROJ_ID + "/tasks/" + ROOT_ID + "/links"
links_ok_count = 0
parts = api("GET", "/parts/?page_size=5", token=ENG)
part_items = parts if isinstance(parts, list) else parts.get("items", [])
if part_items:
    l1 = api("POST", links_url, {"entity_type": "part", "entity_id": part_items[0]["id"]}, token=ENG)
    check(ok(l1), "linked part")
    links_ok_count += 1
else:
    print("  SKIP: no parts")

ecrs = api("GET", "/ecrs/?page=1&page_size=5", token=ENG)
ecr_items = get_items(ecrs)
if ecr_items:
    l2 = api("POST", links_url, {"entity_type": "ec", "entity_id": ecr_items[0]["id"]}, token=ENG)
    check(ok(l2), "linked EC")
    links_ok_count += 1
else:
    print("  SKIP: no ECRs")

docs = api("GET", "/documents/?page_size=5", token=ENG)
doc_items = get_items(docs)
if doc_items:
    l3 = api("POST", links_url, {"entity_type": "document", "entity_id": doc_items[0]["id"]}, token=ENG)
    check(ok(l3), "linked document")
    links_ok_count += 1
else:
    print("  SKIP: no documents")

links = api("GET", links_url, token=ENG)
link_items = get_items(links)
check(len(link_items) == links_ok_count, "link count: " + str(len(link_items)))

# ==== Comments ====
section("Comments")
comments_url = "/projects/" + PROJ_ID + "/tasks/" + ROOT_ID + "/comments"
cmt1 = api("POST", comments_url, {"content": "Design needs review"}, token=ENG)
CMT1_ID = cmt1["id"]
check(ok(cmt1), "engineer comment added")

cmt2 = api("POST", comments_url, {"content": "Received, scheduled"}, token=PROD)
CMT2_ID = cmt2["id"]
check(ok(cmt2), "production comment added")

cmts = api("GET", comments_url, token=ENG)
cmt_items = get_items(cmts)
check(len(cmt_items) == 2, "comment count: " + str(len(cmt_items)))

del_url = comments_url + "/" + CMT2_ID
del_cmt = api("DELETE", del_url, token=PROD)
check(ok(del_cmt), "delete own comment")

cmts2 = api("GET", comments_url, token=ENG)
cmt_items2 = get_items(cmts2)
check(len(cmt_items2) == 1, "remaining: " + str(len(cmt_items2)))

# ==== Production cannot manage members ====
section("Permission: production cannot add member")
add_fail = None
try:
    r = api("POST", member_url, {"user_id": GUEST_UID, "role_in_project": "\u6210\u5458"}, token=PROD)
    add_fail = r
except:
    add_fail = {"__error__": True, "code": 0, "body": "exception"}
code = add_fail.get("code") if isinstance(add_fail, dict) else 200
check(not ok(add_fail) and code == 403, "rejected HTTP " + str(code))

# ==== Soft delete task ====
section("Soft delete task")
del_task_url = "/projects/" + PROJ_ID + "/tasks/" + GRAND_ID
del_task = api("DELETE", del_task_url, token=ENG)
check(ok(del_task), "grandchild deleted")

tree2 = api("GET", tasks_url, token=ENG)
roots2 = get_items(tree2)
if roots2:
    c1 = roots2[0].get("children", [])
    if c1:
        check(len(c1[0].get("children", [])) == 0, "subtree removed")

# ==== Soft delete project ====
section("Soft delete project")
del_proj_url = "/projects/" + PROJ_ID
del_proj = api("DELETE", del_proj_url, token=ENG)
check(ok(del_proj), "project deleted")

final = api("GET", "/projects", token=ENG)
final_items = get_items(final)
check(not any(i["id"] == PROJ_ID for i in final_items), "project hidden")

# ==== Summary ====
print("\n" + "=" * 50)
print("RESULTS: " + str(passed) + " passed, " + str(failed) + " failed")
if failed > 0:
    sys.exit(1)
else:
    print("ALL TESTS PASSED")
