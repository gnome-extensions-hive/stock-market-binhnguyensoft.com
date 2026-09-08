#!/usr/bin/env python3

from __future__ import annotations

import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
# Các mã cần xem
SYMBOLS = [
    "GC=F", "BZ=F", "CL=F", "DX-Y.NYB", "BTC-USD",
    "^DJI", "^GSPC", "^VNINDEX.VN", "MBB.VN", "VCB.VN", "SSI.VN",
]
SYMBOLS_CSV = ",".join(SYMBOLS)

CURL = "/usr/bin/curl"
CONNECT_TIMEOUT = 3
STEP_MAX_TIME = 5
PYTHON_STEP_TIMEOUT = 7
MAX_STDOUT = 2 * 1024 * 1024
MAX_STDERR = 64 * 1024
MAX_CRUMB = 1024

CACHE_DIR = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "stock-market@binhnguyensoft.com"
CACHE_FILE = CACHE_DIR / "quotes.json"


def finite_number(value):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(n) or abs(n) > 1e12:
        return None
    return n


def safe_text(value, limit=180):
    if value is None:
        return ""
    return str(value).replace("\r", " ").replace("\n", " ")[:limit]


def run_curl(args, *, want_stdout=True):
    """Chạy curl trực tiếp, hai tầng timeout riêng biệt: curl và Python để tránh tiến trình bị treo."""
    cmd = [
        CURL,
        "-sS",
        "--connect-timeout", str(CONNECT_TIMEOUT),
        "--max-time", str(STEP_MAX_TIME),
        "--retry", "0",
        "-A", UA,
        *args,
    ]
    try:
        cp = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE if want_stdout else subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=PYTHON_STEP_TIMEOUT,
            check=False,
            start_new_session=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("Không tìm thấy /usr/bin/curl") from exc
    except subprocess.TimeoutExpired as exc:
        # subprocess.run sẽ kill tiến trình con curl khi bị timeout.
        raise TimeoutError("curl vượt quá thời gian an toàn") from exc

    stderr = (cp.stderr or b"")[:MAX_STDERR].decode("utf-8", errors="replace").strip()
    if cp.returncode != 0:
        raise RuntimeError(safe_text(stderr or f"curl exit {cp.returncode}"))

    if not want_stdout:
        return b""

    out = cp.stdout or b""
    if len(out) > MAX_STDOUT:
        raise RuntimeError("Phản hồi Yahoo vượt giới hạn an toàn")
    return out


def load_cache():
    try:
        raw = CACHE_FILE.read_text(encoding="utf-8")
        if len(raw) > MAX_STDOUT:
            return None
        data = json.loads(raw)
        if not isinstance(data, dict) or not isinstance(data.get("rows"), list):
            return None
        by_symbol = {}
        for row in data["rows"]:
            if not isinstance(row, dict):
                continue
            symbol = safe_text(row.get("symbol"), 32)
            if symbol not in SYMBOLS:
                continue
            by_symbol[symbol] = {
                "symbol": symbol,
                "price": finite_number(row.get("price")),
                "change": finite_number(row.get("change")),
                "changePercent": finite_number(row.get("changePercent")),
            }
        rows = [by_symbol.get(sym, {"symbol": sym, "price": None, "change": None, "changePercent": None}) for sym in SYMBOLS]
        return {
            "rows": rows,
            "updatedAt": finite_number(data.get("updatedAt")),
        }
    except Exception:
        return None


def save_cache(rows, updated_at):
    """Cố gắng ghi cache, nếu cache lỗi thì bỏ qua. Cache dùng để lưu dữ liệu gần nhất phòng trường hợp lấy dữ liệu trực tiếp thất bại thì sử dụng lại cache."""
    tmp = CACHE_FILE.with_name(f".{CACHE_FILE.name}.{os.getpid()}.tmp")
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            os.chmod(CACHE_DIR, 0o700)
        except OSError:
            pass
        payload = json.dumps(
            {"rows": rows, "updatedAt": updated_at},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        tmp.write_text(payload, encoding="utf-8")
        os.chmod(tmp, 0o600)
        os.replace(tmp, CACHE_FILE)
    except Exception:
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass


def emit_cache_or_empty(cache, message):
    if cache and cache.get("rows"):
        out = {
            "rows": cache["rows"],
            "liveCount": 0,
            "totalCount": len(SYMBOLS),
            "updatedAt": cache.get("updatedAt"),
            "fromCache": True,
            "warning": "Không cập nhật được; đang dùng dữ liệu gần nhất.",
        }
    else:
        out = {
            "rows": [{"symbol": s, "price": None, "change": None, "changePercent": None} for s in SYMBOLS],
            "liveCount": 0,
            "totalCount": len(SYMBOLS),
            "updatedAt": None,
            "fromCache": False,
            "warning": "Chưa lấy được dữ liệu Yahoo; sẽ tự thử lại.",
        }

    if message:
        print(f"Extension: stock-market@binhnguyensoft.com fetch: {safe_text(message, 300)}", file=sys.stderr)
    print(json.dumps(out, ensure_ascii=False, separators=(",", ":")))


def fetch_live(cookie_jar):
    run_curl([
        "-c", cookie_jar,
        "https://fc.yahoo.com",
        "-o", "/dev/null",
    ], want_stdout=False)

    crumb_bytes = run_curl([
        "-b", cookie_jar,
        "https://query1.finance.yahoo.com/v1/test/getcrumb",
    ])
    if len(crumb_bytes) > MAX_CRUMB:
        raise RuntimeError("Yahoo crumb không hợp lệ")
    crumb = crumb_bytes.decode("utf-8", errors="replace").strip()
    if not crumb or crumb.startswith("{") or "Too Many Requests" in crumb or len(crumb) > 512:
        raise RuntimeError(f"Yahoo crumb không hợp lệ: {safe_text(crumb, 80)}")

    quote_bytes = run_curl([
        "-b", cookie_jar,
        "-G", "https://query1.finance.yahoo.com/v7/finance/quote",
        "--data-urlencode", f"symbols={SYMBOLS_CSV}",
        "--data-urlencode", f"crumb={crumb}",
    ])

    try:
        payload = json.loads(quote_bytes.decode("utf-8", errors="strict"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Yahoo trả dữ liệu JSON không hợp lệ") from exc

    quote_response = payload.get("quoteResponse") if isinstance(payload, dict) else None
    if not isinstance(quote_response, dict):
        raise RuntimeError("Yahoo không trả quoteResponse")
    if quote_response.get("error"):
        raise RuntimeError(safe_text(quote_response.get("error"), 180))
    results = quote_response.get("result") or []
    if not isinstance(results, list):
        raise RuntimeError("Yahoo result không hợp lệ")

    by_symbol = {}
    for q in results:
        if not isinstance(q, dict):
            continue
        symbol = safe_text(q.get("symbol"), 32)
        if symbol not in SYMBOLS:
            continue
        by_symbol[symbol] = {
            "symbol": symbol,
            "price": finite_number(q.get("regularMarketPrice")),
            "change": finite_number(q.get("regularMarketChange")),
            "changePercent": finite_number(q.get("regularMarketChangePercent")),
        }

    live_count = sum(1 for sym in SYMBOLS if sym in by_symbol and by_symbol[sym]["price"] is not None)
    if live_count == 0:
        raise RuntimeError("Yahoo không trả đủ dữ liệu")

    return by_symbol, live_count


def configure_symbols(raw):
    global SYMBOLS, SYMBOLS_CSV
    values = json.loads(raw)
    if not isinstance(values, list) or len(values) > 20:
        raise ValueError("Expected up to 20 symbols")
    normalized = []
    for value in values:
        if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9^][A-Za-z0-9.^=_-]{0,31}", value):
            raise ValueError("Invalid symbol")
        if value.upper() not in normalized:
            normalized.append(value.upper())
    SYMBOLS = normalized
    SYMBOLS_CSV = ",".join(SYMBOLS)


def main():
    if len(sys.argv) > 1:
        configure_symbols(sys.argv[1])
    if not SYMBOLS:
        print(json.dumps({"rows": [], "liveCount": 0, "updatedAt": None}))
        return 0
    cache = load_cache()

    runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
    if (not runtime_dir or not os.path.isdir(runtime_dir) or
            not os.access(runtime_dir, os.W_OK | os.X_OK)):
        runtime_dir = None
    try:
        fd, jar = tempfile.mkstemp(prefix="ystocks.", suffix=".cookie", dir=runtime_dir)
    except OSError:
        # A restricted session may expose XDG_RUNTIME_DIR as read-only.
        fd, jar = tempfile.mkstemp(prefix="ystocks.", suffix=".cookie")
    os.close(fd)
    try:
        os.chmod(jar, 0o600)
    except OSError:
        pass

    try:
        live_by_symbol, live_count = fetch_live(jar)

        old_by_symbol = {}
        if cache:
            old_by_symbol = {r["symbol"]: r for r in cache.get("rows", []) if isinstance(r, dict) and r.get("symbol")}

        # Nếu Yahoo không trả đủ dữ liệu thì dùng lại dữ liệu gần nhất còn lưu tương ứng cho từng mã
        rows = []
        for sym in SYMBOLS:
            row = live_by_symbol.get(sym)
            if row is None or row["price"] is None:
                row = old_by_symbol.get(sym) or row
            if not row:
                row = {"symbol": sym, "price": None, "change": None, "changePercent": None}
            rows.append(row)

        updated_at = int(time.time())
        save_cache(rows, updated_at)

        warning = ""
        if live_count < len(SYMBOLS):
            warning = "Một số mã chưa cập nhật; đang giữ dữ liệu gần nhất cho các mã đó."

        print(json.dumps({
            "rows": rows,
            "liveCount": live_count,
            "totalCount": len(SYMBOLS),
            "updatedAt": updated_at,
            "fromCache": False,
            "warning": warning,
        }, ensure_ascii=False, separators=(",", ":")))
        return 0

    except Exception as exc:
        emit_cache_or_empty(cache, exc)
        return 0
    finally:
        try:
            os.unlink(jar)
        except OSError:
            pass


if __name__ == "__main__":
    try:
        exit_code = main()
    except Exception as exc:
        cache = load_cache()
        emit_cache_or_empty(cache, exc)
        exit_code = 0
    raise SystemExit(exit_code)
