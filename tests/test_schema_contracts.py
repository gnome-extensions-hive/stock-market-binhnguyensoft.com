import ast
import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_ID = "org.gnome.shell.extensions.stock-market-binhnguyensoft-com"
SCHEMA_PATH = "/org/gnome/shell/extensions/stock-market-binhnguyensoft-com/"
SCHEMA_FILE = ROOT / "schemas" / f"{SCHEMA_ID}.gschema.xml"
SYMBOLS = [
    "GC=F", "BZ=F", "CL=F", "DX-Y.NYB", "BTC-USD", "^DJI",
    "^GSPC", "^VNINDEX.VN", "MBB.VN", "VCB.VN", "SSI.VN",
]


class SchemaContracts(unittest.TestCase):
    def setUp(self):
        self.tree = ET.parse(SCHEMA_FILE).getroot()
        self.schemas = self.tree.findall("schema")
        self.assertEqual(len(self.schemas), 1)
        self.schema = self.schemas[0]
        self.keys = {
            key.attrib["name"]: key for key in self.schema.findall("key")
        }

    def default(self, name):
        defaults = self.keys[name].findall("default")
        self.assertEqual(len(defaults), 1, name)
        return ast.literal_eval(defaults[0].text.strip())

    def test_schema_container(self):
        self.assertEqual(self.tree.tag, "schemalist")
        self.assertEqual([child.tag for child in self.tree], ["schema"])

    def test_schema_identity(self):
        metadata = json.loads((ROOT / "metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(metadata["settings-schema"], SCHEMA_ID)
        self.assertEqual(self.schema.attrib["id"], SCHEMA_ID)
        self.assertEqual(self.schema.attrib["path"], SCHEMA_PATH)

    def test_exact_unique_keys(self):
        names = [key.attrib["name"] for key in self.schema.findall("key")]
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(set(names), {"left", "top", "duration", "symbols", "language"})

    def test_key_types(self):
        expected = {
            "left": "i", "top": "i", "duration": "i",
            "symbols": "as", "language": "s",
        }
        for name, variant_type in expected.items():
            with self.subTest(key=name):
                self.assertEqual(self.keys[name].attrib["type"], variant_type)

    def test_position_defaults(self):
        for name in ("left", "top"):
            with self.subTest(key=name):
                self.assertIs(type(self.default(name)), int)
                self.assertEqual(self.default(name), 15)

    def test_duration_default(self):
        self.assertIs(type(self.default("duration")), int)
        self.assertEqual(self.default("duration"), 10)

    def test_position_ranges(self):
        for name in ("left", "top"):
            with self.subTest(key=name):
                ranges = self.keys[name].findall("range")
                self.assertEqual(len(ranges), 1)
                self.assertEqual(ranges[0].attrib, {"min": "0", "max": "10000"})

    def test_duration_range(self):
        ranges = self.keys["duration"].findall("range")
        self.assertEqual(len(ranges), 1)
        self.assertEqual(ranges[0].attrib, {"min": "5", "max": "300"})

    def test_integer_defaults_within_bounds(self):
        for name in ("left", "top", "duration"):
            with self.subTest(key=name):
                bounds = self.keys[name].find("range")
                value = self.default(name)
                self.assertGreaterEqual(value, int(bounds.attrib["min"]))
                self.assertLessEqual(value, int(bounds.attrib["max"]))

    def test_symbols_default(self):
        symbols = self.default("symbols")
        self.assertIs(type(symbols), list)
        self.assertEqual(symbols, SYMBOLS)
        for symbol in symbols:
            with self.subTest(symbol=symbol):
                self.assertIs(type(symbol), str)
                self.assertTrue(symbol)
        self.assertEqual(len(symbols), len(set(symbols)))

    def test_language_default(self):
        self.assertIs(type(self.default("language")), str)
        self.assertEqual(self.default("language"), "auto")

    def test_language_choices(self):
        choices = self.keys["language"].findall("choices")
        self.assertEqual(len(choices), 1)
        values = [choice.attrib["value"] for choice in choices[0]]
        self.assertEqual([choice.tag for choice in choices[0]], ["choice"] * 3)
        self.assertEqual(len(values), len(set(values)))
        self.assertEqual(set(values), {"auto", "en", "vi"})
        self.assertIn(self.default("language"), values)

    def test_no_unexpected_constraints(self):
        for name, key in self.keys.items():
            with self.subTest(key=name):
                tags = [child.tag for child in key]
                expected = {"default", "summary"}
                if name in ("left", "top", "duration"):
                    expected |= {"range", "description"}
                elif name == "symbols":
                    expected.add("description")
                elif name == "language":
                    expected.add("choices")
                self.assertEqual(set(tags), expected)
                self.assertEqual(len(tags), len(set(tags)))


if __name__ == "__main__":
    unittest.main()
