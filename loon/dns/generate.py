#!/usr/bin/env python3
"""Merge GetSomeFries DNS selections with Repcz's ChinaDomain fallback."""

import argparse
import fnmatch
import hashlib
import ipaddress
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen

SOURCE = "https://raw.githubusercontent.com/Repcz/Tool/X/Egern/Rules/ChinaDomain.yaml"
FRIES_SOURCE = "https://raw.githubusercontent.com/VirgilClyne/GetSomeFries/main/plugin/DNS.plugin"
HERE = Path(__file__).resolve().parent
DOMESTIC_DNS = "223.5.5.5"
SYSTEM_DOMAINS = ("seu.edu.cn",)
DOMAIN_KEYS = ("domain_set", "domain_suffix_set", "domain_keyword_set")
IGNORED_KEYS = ("ip_cidr_set", "ip_cidr6_set", "user_agent_set")


def parse_rules(text):
    """Accept the upstream's flat YAML subset; fail on unrecognized syntax."""
    result = {}
    section = None
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if re.fullmatch(r"no_resolve: (true|false)", line):
            section = None
            continue
        match = re.fullmatch(r"([a-z_0-9]+):", line)
        if match:
            section = match[1]
            if section not in DOMAIN_KEYS + IGNORED_KEYS or section in result:
                raise ValueError(f"Line {number}: unknown or duplicate section {section}")
            result[section] = []
            continue
        if section is None or not line.startswith("  - "):
            raise ValueError(f"Line {number}: unsupported YAML syntax")
        value = line[4:].strip()
        if value.startswith("'"):
            if not value.endswith("'") or "'" in value[1:-1].replace("''", ""):
                raise ValueError(f"Line {number}: malformed single-quoted string")
            value = value[1:-1].replace("''", "'")
        elif value.startswith('"'):
            value = json.loads(value)
        if not isinstance(value, str) or not value or any(c.isspace() for c in value):
            raise ValueError(f"Line {number}: expected a nonempty scalar without whitespace")
        result[section].append(value)
    if not result.get("domain_suffix_set"):
        raise ValueError("Refusing to generate an empty domestic domain list")
    return result


def normalize_domain(value):
    value = value.rstrip(".").lower()
    if not value or any(c in value for c in "*?[]#=,:/\\"):
        raise ValueError(f"Invalid domain: {value!r}")
    encoded = value.encode("idna").decode("ascii")
    if len(encoded) > 253 or any(
        not re.fullmatch(r"[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?", label)
        for label in encoded.split(".")
    ):
        raise ValueError(f"Invalid domain: {value!r}")
    return encoded


def build_mappings(rules):
    mappings = set()
    for domain in rules.get("domain_set", []):
        mappings.add(normalize_domain(domain))
    for domain in rules.get("domain_suffix_set", []):
        domain = normalize_domain(domain)
        # A suffix matches the apex and subdomains, but not 'notexample.com'.
        mappings.update((domain, "*." + domain))
    for keyword in rules.get("domain_keyword_set", []):
        if not re.fullmatch(r"[a-zA-Z0-9_.-]+", keyword):
            raise ValueError(f"Unsupported DNS keyword: {keyword!r}")
        mappings.add("*" + keyword.lower() + "*")
    return sorted(mappings)


def parse_fries(source):
    """Import active DNS-server selections, not fixed destination IP mappings."""
    section = None
    selections = {}
    for number, line in enumerate(source.decode("utf-8-sig").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("["):
            if line not in ("[General]", "[Host]"):
                raise ValueError(f"GetSomeFries line {number}: unsupported section")
            section = line
            continue
        if section != "[Host]" or "=" not in line:
            raise ValueError(f"GetSomeFries line {number}: unexpected configuration")
        pattern, value = (part.strip() for part in line.split("=", 1))
        if not value.startswith("server:"):
            ipaddress.ip_address(value)  # Only known fixed-IP entries may be skipped.
            continue
        pattern = pattern.lower()
        if not re.fullmatch(r"[a-z0-9_.*?-]+", pattern) or pattern == "*":
            raise ValueError(f"GetSomeFries line {number}: unsupported pattern")
        if not value[7:] or any(c.isspace() for c in value) or pattern in selections:
            raise ValueError(f"GetSomeFries line {number}: invalid or duplicate mapping")
        selections[pattern] = value
    if not selections:
        raise ValueError("GetSomeFries contains no DNS-server mappings")
    return selections


def inherited_server(pattern, selections):
    """Prevent a more-specific domestic rule from overriding a Fries selection."""
    for upstream, server in selections.items():
        if not any(c in pattern for c in "*?"):
            if fnmatch.fnmatchcase(pattern, upstream):
                return server
        elif pattern.startswith("*.") and upstream.startswith("*."):
            # Every subdomain of this root is within the upstream wildcard.
            root = pattern[2:]
            if fnmatch.fnmatchcase(root, upstream[2:]) or fnmatch.fnmatchcase(root, upstream):
                return server
    return None


def dns_bootstraps(source, selections):
    """Keep upstream fixed IPs only for encrypted DNS servers used by selections."""
    hosts = {urlsplit(value[7:]).hostname for value in selections.values() if "://" in value}
    fixed = {}
    for line in source.decode("utf-8-sig").splitlines():
        if line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        if key.lower() in hosts and not value.startswith("server:"):
            fixed[key.lower()] = str(ipaddress.ip_address(value))
    return fixed


def merge_mappings(rules, selections, bootstraps=None):
    merged = {pattern: "server:system" for domain in SYSTEM_DOMAINS
              for pattern in (domain, "*." + domain)}
    merged.update({key: value for key, value in selections.items() if key not in merged})
    priority = merged.copy()
    merged.update(bootstraps or {})
    for pattern in build_mappings(rules):
        if pattern not in merged:
            # Inherit campus exceptions as well as the upstream selections.
            merged[pattern] = inherited_server(pattern, priority) or f"server:{DOMESTIC_DNS}"
    return merged


def render(source, fries_source):
    rules = parse_rules(source.decode("utf-8-sig"))
    selections = parse_fries(fries_source)
    mappings = merge_mappings(rules, selections, dns_bootstraps(fries_source, selections))
    license_text = (HERE / "Repcz-LICENSE.txt").read_text(encoding="utf-8")
    fries_license = (HERE / "GetSomeFries-LICENSE.txt").read_text(encoding="utf-8")
    header = [
        "#!name = DNS Split - GetSomeFries + ChinaDomain",
        "#!desc = GetSomeFries 指定 DNS 优先；国内名单补充 223.5.5.5；其余沿用主配置默认 DNS。",
        "#!author = jiehu0; DNS selections by VirgilClyne; domain rules by Repcz",
        "#!homepage = https://github.com/jiehu0/Self_use_rule_materials/blob/main/loon/dns/README.md",
        "",
        "# Generated by loon/dns/generate.py; do not edit mappings manually.",
        "# Modified version: DNS-server selections only, ChinaDomain fallback and campus exceptions added.",
        "# SPDX-License-Identifier: GPL-3.0-only",
        f"# GetSomeFries source: {FRIES_SOURCE}",
        f"# GetSomeFries SHA-256: {hashlib.sha256(fries_source).hexdigest()}",
        f"# Active GetSomeFries DNS selections: {len(selections)}",
        f"# Source: {SOURCE}",
        f"# Source SHA-256: {hashlib.sha256(source).hexdigest()}",
        "# Domain source counts: " + ", ".join(f"{key}={len(rules.get(key, []))}" for key in DOMAIN_KEYS),
        "# Not applicable to DNS Host matching: " + ", ".join(f"{key}={len(rules.get(key, []))}" for key in IGNORED_KEYS),
        f"# Generated Host mappings: {len(mappings)}",
        "# Does not replace global DNS, traffic rules, or node DNS settings.",
        "# GetSomeFries: Copyright VirgilClyne; distributed under GPL-3.0.",
        "# Complete upstream license follows:",
    ]
    header.extend("# " + line if line else "#" for line in fries_license.splitlines())
    header.append("# Repcz domain rule data license:")
    header.extend("# " + line if line else "#" for line in license_text.splitlines())
    header.extend(("", "[Host]"))
    header.append("# Campus exceptions, GetSomeFries DNS selections, then ChinaDomain fallback.")
    header.extend(f"{pattern} = {server}" for pattern, server in mappings.items())
    return "\n".join(header) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Read a saved ChinaDomain.yaml instead of downloading")
    parser.add_argument("--fries-source", type=Path, help="Read a saved GetSomeFries DNS.plugin")
    parser.add_argument("--output", type=Path, default=HERE.parent / "ChinaDomain_DNS.plugin")
    args = parser.parse_args()
    if args.source:
        source = args.source.read_bytes()
    else:
        with urlopen(SOURCE, timeout=30) as response:
            source = response.read()
    if args.fries_source:
        fries_source = args.fries_source.read_bytes()
    else:
        with urlopen(FRIES_SOURCE, timeout=30) as response:
            fries_source = response.read()
    plugin = render(source, fries_source)  # Validate before touching the existing file.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp = args.output.with_suffix(args.output.suffix + ".tmp")
    temp.write_text(plugin, encoding="utf-8")
    temp.replace(args.output)
    print(f"Generated {args.output}: {len(plugin.encode('utf-8')):,} bytes")


if __name__ == "__main__":
    main()
