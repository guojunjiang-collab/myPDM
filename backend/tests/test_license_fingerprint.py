"""宿主机硬件指纹采集与容错匹配测试。"""
from app.licensing import fingerprint as fp


def build_host(tmp_path, uuid_val="4c4c4544-0037", machine_id="abc123", macs=None):
    """构造伪造的 /host 目录树。传 None 表示该源不可读。"""
    root = tmp_path / "host"
    root.mkdir(parents=True, exist_ok=True)
    if uuid_val is not None:
        (root / "product_uuid").write_text(uuid_val)
    if machine_id is not None:
        (root / "machine-id").write_text(machine_id)
    net = root / "net"
    net.mkdir(parents=True, exist_ok=True)
    for name, addr in (macs if macs is not None else [("eth0", "aa:bb:cc:dd:ee:ff")]):
        iface = net / name
        iface.mkdir(exist_ok=True)
        (iface / "address").write_text(addr)
    return str(root)


def test_reads_all_three_sources(tmp_path):
    host = build_host(tmp_path)
    src = fp.read_sources(host)
    assert src["uuid"] == "4c4c4544-0037"
    assert src["machine_id"] == "abc123"
    assert src["mac"] == "aa:bb:cc:dd:ee:ff"


def test_ignores_loopback_and_virtual_interfaces(tmp_path):
    host = build_host(tmp_path, macs=[
        ("lo", "00:00:00:00:00:00"),
        ("docker0", "02:42:aa:bb:cc:dd"),
        ("veth1234", "02:42:11:22:33:44"),
        ("br-abcdef", "02:42:55:66:77:88"),
        ("eth0", "aa:bb:cc:dd:ee:ff"),
    ])
    assert fp.read_sources(host)["mac"] == "aa:bb:cc:dd:ee:ff"


def test_machine_code_is_three_segments_and_stable(tmp_path):
    host = build_host(tmp_path)
    code = fp.machine_code(host, str(tmp_path))
    assert len(code.split("-")) == 3
    assert all(len(s) == 8 for s in code.split("-"))
    assert code == fp.machine_code(host, str(tmp_path))


def test_unreadable_source_becomes_sentinel(tmp_path):
    host = build_host(tmp_path, machine_id=None)
    assert fp.machine_code(host, str(tmp_path)).split("-")[1] == fp.SENTINEL


def test_all_sources_match(tmp_path):
    host = build_host(tmp_path)
    expected = fp.machine_code(host, str(tmp_path))
    assert fp.matches(expected, host, str(tmp_path)) is True


def test_one_of_three_differs_still_matches(tmp_path):
    host = build_host(tmp_path)
    expected = fp.machine_code(host, str(tmp_path))
    changed = build_host(tmp_path / "b", macs=[("eth0", "11:22:33:44:55:66")])
    assert fp.matches(expected, changed, str(tmp_path)) is True


def test_two_of_three_differ_does_not_match(tmp_path):
    host = build_host(tmp_path)
    expected = fp.machine_code(host, str(tmp_path))
    changed = build_host(tmp_path / "b", machine_id="zzz",
                         macs=[("eth0", "11:22:33:44:55:66")])
    assert fp.matches(expected, changed, str(tmp_path)) is False


def test_all_three_differ_does_not_match(tmp_path):
    host = build_host(tmp_path)
    expected = fp.machine_code(host, str(tmp_path))
    changed = build_host(tmp_path / "b", uuid_val="zzz", machine_id="yyy",
                         macs=[("eth0", "11:22:33:44:55:66")])
    assert fp.matches(expected, changed, str(tmp_path)) is False


def test_partial_readable_requires_all_readable_to_match(tmp_path):
    """只有 2 源可读时，必须两段全中；错一段即不通过。"""
    host = build_host(tmp_path, uuid_val=None)
    expected = fp.machine_code(host, str(tmp_path))
    changed = build_host(tmp_path / "b", uuid_val=None, machine_id="zzz")
    assert fp.matches(expected, changed, str(tmp_path)) is False


def test_fallback_code_when_no_source_readable(tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    fb = tmp_path / "fb"
    fb.mkdir()
    code1 = fp.machine_code(str(empty), str(fb))
    code2 = fp.machine_code(str(empty), str(fb))
    assert code1.startswith("DOCKER-")
    assert code1 == code2
    assert (fb / ".machine").exists()
    assert fp.matches(code1, str(empty), str(fb)) is True
