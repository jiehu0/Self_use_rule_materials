import fnmatch
import unittest

from generate import build_mappings, merge_mappings, normalize_domain, parse_fries, parse_rules, render


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
FRIES = b"""#!name=DNS enhanced
[General]
[Host]
# *.google.com = server:https://dns.google/dns-query
dns.google = 8.8.8.8
talk.google.com = 108.177.125.188
*.qq.com = server:https://doh.pub/dns-query
*.aliyun.* = server:https://dns.alidns.com/dns-query
*.douyin.com = server:180.184.1.1
*.icloud.com = server:https://doh.dns.apple.com/dns-query
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
        result = render(FIXTURE, FRIES)
        sections = [line for line in result.splitlines() if line.startswith("[")]
        self.assertEqual(sections, ["[Host]"])
        self.assertNotIn("\n* =", result)
        self.assertNotIn("192.0.2.0/24 =", result)
        self.assertNotIn("Example* =", result)
        self.assertIn("ip_cidr_set=1", result)
        self.assertIn("Copyright (c) 2024 Repcz", result)
        self.assertNotIn("talk.google.com =", result)
        self.assertNotIn("dns.google =", result)
        self.assertIn("GPL-3.0", result)
        self.assertEqual(render(FIXTURE, FRIES), result)

    def test_campus_exception_precedes_broad_domestic_suffix(self):
        result = render(b"domain_suffix_set:\n  - edu.cn\n  - seu.edu.cn\n", FRIES)
        rows = [line for line in result.splitlines() if " = server:" in line]
        self.assertEqual(rows[:2], ["seu.edu.cn = server:system", "*.seu.edu.cn = server:system"])
        self.assertIn("*.edu.cn = server:223.5.5.5", rows)
        self.assertNotIn("*.seu.edu.cn = server:223.5.5.5", rows)

    def test_fries_only_imports_active_dns_selections(self):
        selections = parse_fries(FRIES)
        self.assertEqual(len(selections), 4)
        self.assertNotIn("*.google.com", selections)
        self.assertNotIn("talk.google.com", selections)

    def test_fries_unknown_section_or_duplicate_fails(self):
        for extra in (b"[Script]\n", b"*.qq.com = server:223.5.5.5\n"):
            with self.assertRaises(ValueError):
                parse_fries(FRIES + extra)

    def test_overlaps_and_more_specific_domestic_rules_inherit_fries(self):
        rules = {"domain_suffix_set": ["qq.com", "wx.qq.com", "aliyun.com", "bilibili.com", "douyin.com"],
                 "domain_set": ["api.qq.com", "www.douyin.com"]}
        merged = merge_mappings(rules, parse_fries(FRIES))
        for pattern in ("*.qq.com", "wx.qq.com", "*.wx.qq.com", "api.qq.com"):
            self.assertEqual(merged[pattern], "server:https://doh.pub/dns-query")
        self.assertEqual(merged["*.aliyun.com"], "server:https://dns.alidns.com/dns-query")
        self.assertEqual(merged["www.douyin.com"], "server:180.184.1.1")
        self.assertEqual(merged["*.bilibili.com"], "server:223.5.5.5")
        # The upstream *.qq.com does not claim the bare qq.com apex.
        self.assertEqual(merged["qq.com"], "server:223.5.5.5")
        self.assertEqual(merged["*.icloud.com"], "server:https://doh.dns.apple.com/dns-query")
        self.assertNotIn("*.google.com", merged)

    def test_nested_campus_suffix_inherits_system(self):
        merged = merge_mappings({"domain_suffix_set": ["edu.cn", "www.seu.edu.cn"]}, parse_fries(FRIES))
        self.assertEqual(merged["*.www.seu.edu.cn"], "server:system")

    def test_exact_upstream_selection_survives_domestic_apex(self):
        selections = {"static.example.cn": "server:system"}
        merged = merge_mappings({"domain_suffix_set": ["example.cn", "static.example.cn"]}, selections)
        self.assertEqual(merged["static.example.cn"], "server:system")
        # An exact selection must not be expanded to its subdomains.
        self.assertEqual(merged["*.static.example.cn"], "server:223.5.5.5")


if __name__ == "__main__":
    unittest.main()
