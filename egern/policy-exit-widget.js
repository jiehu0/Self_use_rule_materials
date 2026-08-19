const DEFAULT_GROUPS = ["策略选择", "人工智能"];
const REFRESH_MINUTES = 10;

const COLORS = {
  background: { light: "#F2F2F7", dark: "#111113" },
  card: { light: "#FFFFFF", dark: "#1C1C1E" },
  text: { light: "#1C1C1E", dark: "#F2F2F7" },
  secondary: { light: "#6E6E73", dark: "#AEAEB2" },
  accent: { light: "#5856D6", dark: "#7D7AFF" },
  success: { light: "#248A3D", dark: "#30D158" },
  error: { light: "#D70015", dark: "#FF453A" },
};

export default async function (ctx) {
  const groups = [
    clean(ctx.env?.GROUP_1) || DEFAULT_GROUPS[0],
    clean(ctx.env?.GROUP_2) || DEFAULT_GROUPS[1],
  ];
  const results = await Promise.all(groups.map((group) => probeGroup(ctx, group)));
  const family = ctx.widgetFamily || "systemMedium";

  if (family === "accessoryInline") {
    return renderInline(results);
  }
  if (family === "accessoryCircular") {
    return renderCircular(results);
  }
  if (family === "accessoryRectangular") {
    return renderRectangular(results);
  }

  return renderHomeScreen(results, family === "systemSmall");
}

async function probeGroup(ctx, group) {
  const providers = [
    {
      url: "https://ipwho.is/?fields=success,message,ip,country_code,country,city,connection",
      parse(data) {
        if (data.success === false || !data.ip) return null;
        return {
          ip: data.ip,
          countryCode: data.country_code,
          country: data.country,
          city: data.city,
          isp: data.connection?.isp || data.connection?.org,
          asn: data.connection?.asn,
        };
      },
    },
    {
      url: "http://ip-api.com/json/?lang=zh-CN&fields=status,message,query,countryCode,country,city,isp,org,as",
      parse(data) {
        if (data.status !== "success" || !data.query) return null;
        return {
          ip: data.query,
          countryCode: data.countryCode,
          country: data.country,
          city: data.city,
          isp: data.isp || data.org,
          asn: data.as,
        };
      },
    },
  ];

  const startedAt = Date.now();
  for (const provider of providers) {
    try {
      const separator = provider.url.includes("?") ? "&" : "?";
      const response = await ctx.http.get(`${provider.url}${separator}_=${Date.now()}`, {
        policy: group,
        timeout: 7000,
        credentials: "omit",
        headers: { "Cache-Control": "no-cache" },
      });
      const parsed = provider.parse(await response.json());
      if (parsed) {
        return {
          group,
          ok: true,
          latency: Date.now() - startedAt,
          ...parsed,
        };
      }
    } catch (_) {
      // Try the next provider.
    }
  }

  return { group, ok: false, latency: Date.now() - startedAt };
}

function renderHomeScreen(results, compact) {
  return {
    type: "widget",
    url: "egern:/connections",
    padding: compact ? 12 : 14,
    gap: compact ? 8 : 10,
    backgroundColor: COLORS.background,
    refreshAfter: nextRefresh(),
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          {
            type: "image",
            src: "sf-symbol:point.3.connected.trianglepath.dotted",
            width: 16,
            height: 16,
            color: COLORS.accent,
          },
          { type: "spacer", length: 6 },
          text("策略出口", compact ? 14 : 15, "bold", COLORS.text),
          { type: "spacer" },
          {
            type: "date",
            date: new Date().toISOString(),
            format: "time",
            font: { size: 10, weight: "medium" },
            textColor: COLORS.secondary,
          },
        ],
      },
      ...results.map((result) => renderCard(result, compact)),
    ],
  };
}

function renderCard(result, compact) {
  const flag = result.ok ? countryFlag(result.countryCode) : "⚠️";
  const location = result.ok
    ? [result.country, result.city].filter(Boolean).join(" · ") || "未知地区"
    : "探测失败，请检查分组名称";
  const detail = result.ok
    ? [result.ip, formatAsn(result.asn), result.isp].filter(Boolean).join(" · ")
    : "将在下次刷新时重试";

  return {
    type: "stack",
    direction: "column",
    gap: compact ? 3 : 5,
    padding: compact ? [8, 10] : [10, 12],
    backgroundColor: COLORS.card,
    borderRadius: 12,
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          text(result.group, compact ? 12 : 13, "semibold", COLORS.text, 1),
          { type: "spacer" },
          text(`${result.latency} ms`, 10, "medium", result.ok ? COLORS.success : COLORS.error, 1),
        ],
      },
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 5,
        children: [
          text(flag, compact ? 14 : 16, "regular", COLORS.text, 1),
          text(location, compact ? 11 : 12, "medium", result.ok ? COLORS.text : COLORS.error, 1),
        ],
      },
      ...(compact
        ? []
        : [text(detail, 10, "regular", COLORS.secondary, 1, 0.55)]),
    ],
  };
}

function renderInline(results) {
  const value = results
    .map((result) => `${shortName(result.group)} ${result.ok ? countryFlag(result.countryCode) : "⚠️"}`)
    .join(" · ");
  return { type: "widget", refreshAfter: nextRefresh(), children: [text(value, "caption1", "semibold")] };
}

function renderCircular(results) {
  const value = results.map((result) => (result.ok ? countryFlag(result.countryCode) : "⚠️")).join("\n");
  return {
    type: "widget",
    refreshAfter: nextRefresh(),
    children: [
      {
        type: "text",
        text: value,
        font: { size: 15, weight: "bold" },
        textAlign: "center",
        maxLines: 2,
      },
    ],
  };
}

function renderRectangular(results) {
  return {
    type: "widget",
    gap: 2,
    refreshAfter: nextRefresh(),
    children: results.map((result) => ({
      type: "stack",
      direction: "row",
      children: [
        text(shortName(result.group), 11, "semibold", undefined, 1),
        { type: "spacer" },
        text(result.ok ? `${countryFlag(result.countryCode)} ${result.country || ""}` : "⚠️ 失败", 11, "medium", undefined, 1),
      ],
    })),
  };
}

function text(value, size, weight, color, maxLines, minScale) {
  return {
    type: "text",
    text: String(value || ""),
    font: { size, weight },
    ...(color ? { textColor: color } : {}),
    ...(maxLines ? { maxLines } : {}),
    ...(minScale ? { minScale } : {}),
  };
}

function countryFlag(countryCode) {
  const code = clean(countryCode).toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(...[...code].map((letter) => 127397 + letter.charCodeAt(0)));
}

function formatAsn(value) {
  const raw = clean(value);
  if (!raw) return "";
  return /^AS/i.test(raw) ? raw : `AS${raw}`;
}

function shortName(value) {
  const name = clean(value);
  return name.length > 6 ? `${name.slice(0, 6)}…` : name;
}

function clean(value) {
  return String(value || "").trim();
}

function nextRefresh() {
  return new Date(Date.now() + REFRESH_MINUTES * 60 * 1000).toISOString();
}
