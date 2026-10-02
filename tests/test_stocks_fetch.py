import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import runpy
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "stocks_fetch.py"


class StocksFetchTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("stocks_fetch", MODULE_PATH)
        self.fetch = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.fetch)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.fetch.CACHE_DIR = self.directory / "cache"
        self.fetch.CACHE_FILE = self.fetch.CACHE_DIR / "quotes.json"
        self.process = self.enterContext(patch.object(
            self.fetch.subprocess, "run",
            side_effect=AssertionError("Unexpected external process"),
        ))
        self.enterContext(patch.dict(os.environ, {
            "XDG_RUNTIME_DIR": self.temp.name,
        }))

    def row(self, symbol, price=None, change=None, percent=None):
        return {
            "symbol": symbol, "price": price,
            "change": change, "changePercent": percent,
        }

    def write_cache(self, data):
        self.fetch.CACHE_DIR.mkdir(exist_ok=True)
        self.fetch.CACHE_FILE.write_text(json.dumps(data), encoding="utf-8")

    def quotes(self, result):
        return json.dumps({"quoteResponse": {"result": result}}).encode()

    def call_main(self, symbols, live=None, error=None):
        stdout, stderr = io.StringIO(), io.StringIO()
        with (
            patch.object(self.fetch.sys, "argv", ["stocks_fetch.py", json.dumps(symbols)]),
            patch.object(self.fetch, "fetch_live", return_value=live,
                         side_effect=error) as fetch_live,
            patch.object(self.fetch.time, "time", return_value=1234),
            contextlib.redirect_stdout(stdout),
            contextlib.redirect_stderr(stderr),
        ):
            self.assertEqual(self.fetch.main(), 0)
        self.assertEqual(len(stdout.getvalue().splitlines()), 1)
        return json.loads(stdout.getvalue()), stderr.getvalue(), fetch_live

    def test_finite_number_boundaries(self):
        for value, expected in [
            (0, 0.0), ("12.5", 12.5), (-1e12, -1e12), (1e12, 1e12),
            (None, None), ("bad", None), ({}, None), ([], None),
            (float("nan"), None), (float("inf"), None),
            (-float("inf"), None), (1e12 + 1, None), (-1e12 - 1, None),
        ]:
            with self.subTest(value=value):
                self.assertEqual(self.fetch.finite_number(value), expected)

    def test_safe_text_normalizes_and_limits(self):
        self.assertEqual(self.fetch.safe_text(None), "")
        self.assertEqual(self.fetch.safe_text(42), "42")
        self.assertEqual(self.fetch.safe_text("a\r\nb", 3), "a  ")
        self.assertEqual(len(self.fetch.safe_text("x" * 181)), 180)

    def test_configure_symbols_normalizes_deduplicates_and_preserves_order(self):
        self.fetch.configure_symbols('["mbb.vn","BTC-USD","MBB.VN","^GSPC","GC=F"]')
        self.assertEqual(self.fetch.SYMBOLS, ["MBB.VN", "BTC-USD", "^GSPC", "GC=F"])
        self.assertEqual(self.fetch.SYMBOLS_CSV, "MBB.VN,BTC-USD,^GSPC,GC=F")
        self.fetch.configure_symbols("[]")
        self.assertEqual(self.fetch.SYMBOLS, [])
        self.assertEqual(self.fetch.SYMBOLS_CSV, "")

    def test_configure_symbols_length_limits(self):
        symbols = ["A" * 32] + [f"S{i}" for i in range(19)]
        self.fetch.configure_symbols(json.dumps(symbols))
        self.assertEqual(self.fetch.SYMBOLS, symbols)
        with self.assertRaises(ValueError):
            self.fetch.configure_symbols(json.dumps(symbols + ["EXTRA"]))

    def test_configure_symbols_rejects_invalid_input_without_mutating_watchlist(self):
        original = list(self.fetch.SYMBOLS)
        for raw in [
            "{", "null", "{}", '"BTC-USD"', "[1]", "[null]",
            '[""]', '[" BTC-USD"]', '["BTC USD"]', '["-ABC"]',
            '["A/B"]', '["A;B"]', '["A\\nB"]', '["ABC","bad symbol"]',
            json.dumps(["A" * 33]),
        ]:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                self.fetch.configure_symbols(raw)
            self.assertEqual(self.fetch.SYMBOLS, original)
            self.assertEqual(self.fetch.SYMBOLS_CSV, ",".join(original))

    def test_run_curl_arguments_and_timeouts(self):
        self.process.side_effect = None
        self.process.return_value = subprocess.CompletedProcess([], 0, b"quotes", b"")
        self.assertEqual(self.fetch.run_curl(["-b", "jar", "https://example.invalid"]), b"quotes")
        args, kwargs = self.process.call_args
        self.assertEqual(args[0], [
            self.fetch.CURL, "-sS", "--connect-timeout", "3",
            "--max-time", "5", "--retry", "0", "-A", self.fetch.UA,
            "-b", "jar", "https://example.invalid",
        ])
        self.assertEqual(kwargs, {
            "stdin": subprocess.DEVNULL, "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE, "timeout": 7,
            "check": False, "start_new_session": True,
        })
        self.assertEqual(self.fetch.run_curl(["url"], want_stdout=False), b"")
        self.assertEqual(self.process.call_args.kwargs["stdout"], subprocess.DEVNULL)

    def test_run_curl_translates_process_errors(self):
        for error, expected in [
            (FileNotFoundError(), RuntimeError),
            (subprocess.TimeoutExpired("curl", 7), TimeoutError),
        ]:
            with self.subTest(error=error):
                self.process.side_effect = error
                with self.assertRaises(expected) as raised:
                    self.fetch.run_curl(["url"])
                self.assertIs(raised.exception.__cause__, error)

    def test_run_curl_exit_and_output_limits(self):
        self.process.side_effect = None
        for stderr, message in [(b"failed\nrequest", "failed request"),
                                (b"", "curl exit 22"), (b"\xff", "\ufffd")]:
            self.process.return_value = subprocess.CompletedProcess([], 22, b"", stderr)
            with self.subTest(stderr=stderr), self.assertRaisesRegex(RuntimeError, message):
                self.fetch.run_curl(["url"])
        self.process.return_value = subprocess.CompletedProcess(
            [], 0, b"x" * self.fetch.MAX_STDOUT, b"")
        self.assertEqual(len(self.fetch.run_curl(["url"])), self.fetch.MAX_STDOUT)
        self.process.return_value.stdout += b"x"
        with self.assertRaises(RuntimeError):
            self.fetch.run_curl(["url"])

    def test_load_cache_rejects_missing_malformed_or_oversized_data(self):
        self.assertIsNone(self.fetch.load_cache())
        for data in [[], {}, {"rows": {}}, {"rows": None}]:
            self.write_cache(data)
            with self.subTest(data=data):
                self.assertIsNone(self.fetch.load_cache())
        for raw in ["{", " " * (self.fetch.MAX_STDOUT + 1)]:
            self.fetch.CACHE_FILE.write_text(raw, encoding="utf-8")
            self.assertIsNone(self.fetch.load_cache())

    def test_load_cache_filters_normalizes_and_orders_rows(self):
        self.fetch.configure_symbols('["BTC-USD","MBB.VN","GC=F"]')
        self.write_cache({
            "updatedAt": "1000",
            "rows": [
                None, self.row("UNKNOWN", 5), self.row("MBB.VN", "25", float("inf")),
                self.row("BTC-USD", 1), self.row("BTC-USD", "2", "-3", "4"),
            ],
        })
        self.assertEqual(self.fetch.load_cache(), {
            "updatedAt": 1000.0,
            "rows": [
                self.row("BTC-USD", 2.0, -3.0, 4.0),
                self.row("MBB.VN", 25.0), self.row("GC=F"),
            ],
        })

    def test_save_cache_round_trip_permissions_and_atomic_replacement(self):
        rows = [self.row(self.fetch.SYMBOLS[0], 42, -1, -2)]
        self.fetch.save_cache(rows, 1000)
        self.assertEqual(json.loads(self.fetch.CACHE_FILE.read_text()), {
            "rows": rows, "updatedAt": 1000,
        })
        self.assertEqual(stat.S_IMODE(self.fetch.CACHE_DIR.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.fetch.CACHE_FILE.stat().st_mode), 0o600)
        self.assertEqual(list(self.fetch.CACHE_DIR.iterdir()), [self.fetch.CACHE_FILE])
        self.assertEqual(self.fetch.load_cache()["rows"][0], rows[0])
        self.fetch.save_cache(rows, 2000)
        self.assertEqual(self.fetch.load_cache()["updatedAt"], 2000)

    def test_failed_cache_replacement_preserves_previous_data_and_removes_temp(self):
        self.fetch.save_cache([], 1000)
        with patch.object(self.fetch.os, "replace", side_effect=OSError("read-only")):
            self.fetch.save_cache([], 2000)
        self.assertEqual(self.fetch.load_cache()["updatedAt"], 1000)
        self.assertEqual(list(self.fetch.CACHE_DIR.iterdir()), [self.fetch.CACHE_FILE])

    def test_fetch_live_handshake_and_quote_normalization(self):
        self.fetch.configure_symbols('["BTC-USD","MBB.VN","GC=F"]')
        result = [
            None, {"symbol": "UNKNOWN", "regularMarketPrice": 99},
            {"symbol": "MBB.VN", "regularMarketPrice": "25",
             "regularMarketChange": "-2", "regularMarketChangePercent": "3"},
            {"symbol": "BTC-USD", "regularMarketPrice": float("inf")},
            {"symbol": "BTC-USD", "regularMarketPrice": 100},
        ]
        with patch.object(self.fetch, "run_curl", side_effect=[
            b"", b" crumb/+ \n", self.quotes(result),
        ]) as curl:
            rows, count = self.fetch.fetch_live("cookie.jar")
        self.assertEqual(count, 2)
        self.assertEqual(rows, {
            "MBB.VN": self.row("MBB.VN", 25, -2, 3),
            "BTC-USD": self.row("BTC-USD", 100),
        })
        self.assertEqual(curl.call_args_list[0].args[0],
                         ["-c", "cookie.jar", "https://fc.yahoo.com", "-o", "/dev/null"])
        self.assertEqual(curl.call_args_list[0].kwargs, {"want_stdout": False})
        self.assertEqual(curl.call_args_list[1].args[0], [
            "-b", "cookie.jar", "https://query1.finance.yahoo.com/v1/test/getcrumb",
        ])
        self.assertEqual(curl.call_args_list[2].args[0], [
            "-b", "cookie.jar", "-G", "https://query1.finance.yahoo.com/v7/finance/quote",
            "--data-urlencode", "symbols=BTC-USD,MBB.VN,GC=F",
            "--data-urlencode", "crumb=crumb/+",
        ])

    def test_fetch_live_rejects_invalid_crumb_before_quote_request(self):
        for crumb in [b"", b" \n", b"{}", b"Too Many Requests",
                      b"x" * 513, b"x" * (self.fetch.MAX_CRUMB + 1)]:
            with (
                self.subTest(crumb=crumb[:30]),
                patch.object(self.fetch, "run_curl", side_effect=[b"", crumb]) as curl,
                self.assertRaises(RuntimeError),
            ):
                self.fetch.fetch_live("jar")
            self.assertEqual(curl.call_count, 2)

    def test_fetch_live_rejects_bad_quote_payloads_and_missing_prices(self):
        payloads = [
            b"\xff", b"{", b"[]", b"{}", b'{"quoteResponse":[]}',
            b'{"quoteResponse":{"error":"upstream failure"}}',
            b'{"quoteResponse":{"result":"bad"}}', self.quotes([]),
            self.quotes([{"symbol": "BTC-USD", "regularMarketPrice": None}]),
            self.quotes([{"symbol": "UNKNOWN", "regularMarketPrice": 5}]),
        ]
        for payload in payloads:
            with (
                self.subTest(payload=payload),
                patch.object(self.fetch, "run_curl", side_effect=[b"", b"crumb", payload]),
                self.assertRaises(RuntimeError),
            ):
                self.fetch.fetch_live("jar")

    def test_main_empty_watchlist_skips_fetch_and_cache(self):
        with patch.object(self.fetch, "load_cache") as cache:
            data, stderr, live = self.call_main([])
        self.assertEqual(data, {"rows": [], "liveCount": 0, "updatedAt": None})
        self.assertEqual(stderr, "")
        cache.assert_not_called()
        live.assert_not_called()
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_main_live_rows_output_cache_and_cookie_cleanup(self):
        rows = {"BTC-USD": self.row("BTC-USD", 100, -2, -3)}
        data, stderr, live = self.call_main(["BTC-USD"], live=(rows, 1))
        self.assertEqual(data, {
            "rows": list(rows.values()), "liveCount": 1, "totalCount": 1,
            "updatedAt": 1234, "fromCache": False, "warning": "",
        })
        self.assertEqual(stderr, "")
        self.assertEqual(self.fetch.load_cache()["rows"], data["rows"])
        self.assertFalse(Path(live.call_args.args[0]).exists())

    def test_main_partial_live_data_uses_cache_then_empty_rows_in_watchlist_order(self):
        old = self.row("MBB.VN", 20, 1, 2)
        self.write_cache({"rows": [old], "updatedAt": 1000})
        rows = {"BTC-USD": self.row("BTC-USD", 100), "MBB.VN": self.row("MBB.VN")}
        data, stderr, _ = self.call_main(
            ["MBB.VN", "BTC-USD", "GC=F"], live=(rows, 1))
        self.assertEqual(data["rows"], [old, rows["BTC-USD"], self.row("GC=F")])
        self.assertEqual(data["liveCount"], 1)
        self.assertEqual(data["totalCount"], 3)
        self.assertFalse(data["fromCache"])
        self.assertTrue(data["warning"])
        self.assertEqual(stderr, "")
        self.assertEqual(self.fetch.load_cache()["rows"], data["rows"])

    def test_main_fetch_failure_returns_cache_without_replacing_timestamp(self):
        row = self.row("BTC-USD", 80)
        self.write_cache({"rows": [row], "updatedAt": 1000})
        data, stderr, live = self.call_main(["BTC-USD"], error=TimeoutError("offline\nretry"))
        self.assertTrue(data.pop("warning"))
        self.assertEqual(data, {
            "rows": [row], "liveCount": 0, "totalCount": 1,
            "updatedAt": 1000, "fromCache": True,
        })
        self.assertIn("offline retry", stderr)
        self.assertEqual(len(stderr.splitlines()), 1)
        self.assertEqual(self.fetch.load_cache()["updatedAt"], 1000)
        self.assertFalse(Path(live.call_args.args[0]).exists())

    def test_main_fetch_failure_without_cache_emits_null_rows_and_diagnostic(self):
        data, stderr, live = self.call_main(["BTC-USD"], error=RuntimeError("offline"))
        self.assertEqual(data["rows"], [self.row("BTC-USD")])
        self.assertEqual(data["liveCount"], 0)
        self.assertEqual(data["totalCount"], 1)
        self.assertIsNone(data["updatedAt"])
        self.assertFalse(data["fromCache"])
        self.assertTrue(data["warning"])
        self.assertIn("offline", stderr)
        self.assertFalse(self.fetch.CACHE_FILE.exists())
        self.assertFalse(Path(live.call_args.args[0]).exists())

    def test_main_cookie_creation_falls_back_when_runtime_directory_is_restricted(self):
        mkstemp = self.fetch.tempfile.mkstemp

        def restricted_mkstemp(**kwargs):
            if kwargs.get("dir") == self.temp.name:
                raise OSError("read-only")
            return mkstemp(**kwargs)

        with patch.object(self.fetch.tempfile, "mkstemp",
                          side_effect=restricted_mkstemp) as create:
            data, _, live = self.call_main(["BTC-USD"], error=RuntimeError("offline"))
        self.assertFalse(data["fromCache"])
        self.assertEqual(create.call_args_list[0].kwargs["dir"], self.temp.name)
        self.assertNotIn("dir", create.call_args_list[1].kwargs)
        self.assertFalse(Path(live.call_args.args[0]).exists())

    def test_main_invalid_runtime_directory_uses_default_temp_directory(self):
        with patch.dict(os.environ, {"XDG_RUNTIME_DIR": str(self.directory / "missing")}):
            with patch.object(self.fetch.tempfile, "mkstemp",
                              wraps=self.fetch.tempfile.mkstemp) as create:
                _, _, live = self.call_main(["BTC-USD"], error=RuntimeError("offline"))
        self.assertIsNone(create.call_args.kwargs["dir"])
        self.assertFalse(Path(live.call_args.args[0]).exists())

    def test_main_partial_live_data_without_cache_fills_missing_rows(self):
        row = self.row("BTC-USD", 100)
        data, stderr, _ = self.call_main(
            ["BTC-USD", "GC=F"], live=({"BTC-USD": row}, 1))
        self.assertEqual(data["rows"], [row, self.row("GC=F")])
        self.assertEqual(data["liveCount"], 1)
        self.assertEqual(data["totalCount"], 2)
        self.assertTrue(data["warning"])
        self.assertEqual(stderr, "")

    def test_script_entry_point_emits_json_and_exits_zero_on_failure(self):
        for raw in ['["BTC-USD"]', '["bad symbol"]']:
            stdout, stderr = io.StringIO(), io.StringIO()
            self.process.reset_mock()
            self.process.side_effect = FileNotFoundError("curl missing")
            with (
                self.subTest(raw=raw),
                patch.dict(os.environ, {"XDG_CACHE_HOME": self.temp.name}),
                patch.object(self.fetch.sys, "argv", ["stocks_fetch.py", raw]),
                contextlib.redirect_stdout(stdout),
                contextlib.redirect_stderr(stderr),
                self.assertRaises(SystemExit) as exited,
            ):
                runpy.run_path(str(MODULE_PATH), run_name="__main__")
            self.assertEqual(exited.exception.code, 0)
            self.assertEqual(len(stdout.getvalue().splitlines()), 1)
            data = json.loads(stdout.getvalue())
            self.assertEqual(data["liveCount"], 0)
            self.assertFalse(data["fromCache"])
            self.assertTrue(data["warning"])
            self.assertTrue(stderr.getvalue())
            self.assertTrue(all(row["price"] is None for row in data["rows"]))
            if raw == '["BTC-USD"]':
                self.assertEqual(data["rows"], [self.row("BTC-USD")])
                self.process.assert_called_once()
            else:
                self.process.assert_not_called()
            self.assertEqual(list(self.directory.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
