import fnmatch
import unittest

from generate import build_mappings, normalize_domain, parse_rules, render


FIXTURE = b"""no_resolve: true
domain_set:
  - exact.example.org
domain_suffix_set:
  - bilibili.com
  - douyin.com
domain_keyword_set:
  - '-cdn-marker'
ip_cidr_set:
  - 192.0.2.0/24
ip_cidr6_set:
  - 2001:db8::/32
user_agent_set:
  - 'Example*'
"""


class DNSMappingTests(unittest.TestCase):
    def setUp(self):
        self.mappings = build_mappings(parse_rules(FIXTURE.decode()))

    def matches(self, host):
        return any(fnmatch.fnmatchcase(host.lower(), pattern) for pattern in self.mappings)

    def test_suffix_apex_and_nested_subdomains(self):
        for host in ("bilibili.com", "www.bilibili.com", "a.b.bilibili.com", "WWW.DOUYIN.COM"):
            self.assertTrue(self.matches(host), host)
        for host in ("notbilibili.com", "bilibili.com.evil.test", "www.google.com"):
            self.assertFalse(self.matches(host), host)

    def test_exact_domain_does_not_expand(self):
        self.assertTrue(self.matches("exact.example.org"))
        self.assertFalse(self.matches("sub.exact.example.org"))

    def test_keyword_preserves_contains_semantics(self):
        self.assertTrue(self.matches("video-cdn-marker.example.org"))
        self.assertFalse(self.matches("video-cdnmarker.example.org"))

    def test_idn_and_duplicate_entries(self):
        rules = {"domain_suffix_set": ["飞飞.中国", "xn--q35aa.xn--fiqs8s", "Example.COM."]}
        mappings = build_mappings(rules)
        self.assertIn(normalize_domain("飞飞.中国"), mappings)
        self.assertIn("*.xn--q35aa.xn--fiqs8s", mappings)
        self.assertIn("example.com", mappings)
        self.assertEqual(len(mappings), 4)

    def test_unknown_schema_fails_instead_of_silent_loss(self):
        with self.assertRaises(ValueError):
            parse_rules(FIXTURE.decode() + "domain_regex_set:\n  - '.*'\n")
        with self.assertRaises(ValueError):
            parse_rules("domain_suffix_set:\n  - \n")
        with self.assertRaises(ValueError):
            parse_rules("domain_suffix_set:\n  - example.com\n  nested: true\n")

    def test_invalid_patterns_cannot_inject_config(self):
        for value in ("*.example.com", "example.com,other", "example.com = server:system", "bad..com"):
            with self.assertRaises(ValueError):
                normalize_domain(value)

    def test_output_has_no_catchall_or_traffic_overrides(self):
        result = render(FIXTURE)
        sections = [line for line in result.splitlines() if line.startswith("[")]
        self.assertEqual(sections, ["[Host]"])
        self.assertNotIn("\n* =", result)
        self.assertNotIn("192.0.2.0/24 =", result)
        self.assertNotIn("Example* =", result)
        self.assertIn("ip_cidr_set=1", result)
        self.assertIn("Copyright (c) 2024 Repcz", result)
        self.assertEqual(render(FIXTURE), result)

    def test_campus_exception_precedes_broad_domestic_suffix(self):
        result = render(b"domain_suffix_set:\n  - edu.cn\n  - seu.edu.cn\n")
        rows = [line for line in result.splitlines() if " = server:" in line]
        self.assertEqual(rows[:2], ["seu.edu.cn = server:system", "*.seu.edu.cn = server:system"])
        self.assertIn("*.edu.cn = server:223.5.5.5", rows)
        self.assertNotIn("*.seu.edu.cn = server:223.5.5.5", rows)


if __name__ == "__main__":
    unittest.main()
