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
  if (family === "systemMedium") {
    return renderMedium(results);
  }
  if (family === "systemLarge" || family === "systemExtraLarge") {
    return renderLarge(results);
  }

  return renderSmall(results);
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

function renderSmall(results) {
  return {
    type: "widget",
    url: "egern:/connections",
    padding: 12,
    gap: 8,
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
          text("策略出口", 14, "bold", COLORS.text),
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
      ...results.map(renderSmallCard),
    ],
  };
}

function renderMedium(results) {
  return {
    type: "widget",
    url: "egern:/connections",
    padding: [10, 12],
    gap: 6,
    backgroundColor: COLORS.background,
    refreshAfter: nextRefresh(),
    children: results.map(renderMediumRow),
  };
}

function renderMediumRow(result) {
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
    alignItems: "start",
    gap: 3,
    padding: [7, 10],
    backgroundColor: COLORS.card,
    borderRadius: 11,
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          text(result.group, 12, "semibold", COLORS.text, 1, 0.7),
          { type: "spacer" },
          text(`${result.latency} ms`, 10, "semibold", result.ok ? COLORS.success : COLORS.error, 1),
        ],
      },
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 5,
        children: [
          text(flag, 13, "regular", COLORS.text, 1),
          { ...text(location, 11, "medium", result.ok ? COLORS.text : COLORS.error, 1, 0.65), flex: 1 },
        ],
      },
      text(detail, 9, "regular", COLORS.secondary, 1, 0.5),
    ],
  };
}

function renderLarge(results) {
  return {
    type: "widget",
    url: "egern:/connections",
    padding: 16,
    gap: 12,
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
            width: 18,
            height: 18,
            color: COLORS.accent,
          },
          { type: "spacer", length: 7 },
          text("策略出口", 16, "bold", COLORS.text),
          { type: "spacer" },
          {
            type: "date",
            date: new Date().toISOString(),
            format: "time",
            font: { size: 11, weight: "medium" },
            textColor: COLORS.secondary,
          },
        ],
      },
      {
        type: "stack",
        direction: "row",
        alignItems: "start",
        gap: 12,
        flex: 1,
        children: results.map(renderLargeCard),
      },
    ],
  };
}

function renderLargeCard(result) {
  const flag = result.ok ? countryFlag(result.countryCode) : "⚠️";
  const location = result.ok
    ? [result.country, result.city].filter(Boolean).join(" · ") || "未知地区"
    : "探测失败";
  const network = result.ok
    ? [formatAsn(result.asn), result.isp].filter(Boolean).join(" · ")
    : "请检查策略组名称";

  return {
    type: "stack",
    direction: "column",
    alignItems: "start",
    gap: 8,
    padding: 14,
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    children: [
      text(result.group, 15, "bold", COLORS.text, 1, 0.65),
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 7,
        children: [
          text(flag, 24, "regular", COLORS.text, 1),
          { ...text(location, 14, "semibold", result.ok ? COLORS.text : COLORS.error, 2, 0.65), flex: 1 },
        ],
      },
      { type: "spacer" },
      text(result.ok ? result.ip : "暂无出口信息", 13, "medium", COLORS.text, 1, 0.6),
      text(network, 11, "regular", COLORS.secondary, 2, 0.55),
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          text("探测延迟", 11, "medium", COLORS.secondary, 1),
          { type: "spacer" },
          text(`${result.latency} ms`, 12, "bold", result.ok ? COLORS.success : COLORS.error, 1),
        ],
      },
    ],
  };
}

function renderSmallCard(result) {
  const flag = result.ok ? countryFlag(result.countryCode) : "⚠️";
  const location = result.ok
    ? [result.country, result.city].filter(Boolean).join(" · ") || "未知地区"
    : "探测失败，请检查分组名称";

  return {
    type: "stack",
    direction: "column",
    gap: 3,
    padding: [8, 10],
    backgroundColor: COLORS.card,
    borderRadius: 12,
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          text(result.group, 12, "semibold", COLORS.text, 1),
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
          text(flag, 14, "regular", COLORS.text, 1),
          text(location, 11, "medium", result.ok ? COLORS.text : COLORS.error, 1),
        ],
      },
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
