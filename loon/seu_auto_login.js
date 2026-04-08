/*********************************
 * Loon cron / network-changed Script
 * 东南大学校园网自动登录（SEU-ISP / SEU-WLAN）
 *
 * 依据：
 * - Loon 脚本 API 文档
 * - LoonExampleConfig 脚本/配置格式
 *
 * 说明：
 * 1. 本脚本不负责连接 Wi-Fi，只在连上 SEU 相关 Wi-Fi 后运行。
 * 2. 通过 $config.getConfig() 获取当前 ssid。
 * 3. 通过在线接口检测是否已登录，未登录时发起登录。
 * 4. SEU-ISP 会按 中国移动 -> 中国电信 -> 中国联通 轮询。
 * 5. 登录成功后发送本地通知。
 *
 * 使用前必须修改：
 * - CONFIG.username
 * - CONFIG.password
 *********************************/

const CONFIG = {
  username: "220252341",
  password: "YOUR_PASSWORD",
  jsVersionFallback: "3.3.3",

  targetSSIDs: ["SEU-ISP", "SEU-WLAN"],
  targetPrefix: "SEU",

  ispCycle: [
    { name: "中国移动", suffix: "@cmcc" },
    { name: "中国电信", suffix: "@telecom" },
    { name: "中国联通", suffix: "@unicom" }
  ],

  notifyOnSuccess: true,
  notifyOnFailure: false,
  successNotifyThrottleSec: 600,

  urlLogin: "https://w.seu.edu.cn:801/eportal/",
  urlJsVersion: "https://w.seu.edu.cn/a41.js",
  chkStatusUrls: [
    "https://w.seu.edu.cn/drcom/chkstatus",
    "https://w.seu.edu.cn:802/drcom/chkstatus"
  ],

  headers: {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile",
    "Referer": "http://202.119.25.2/",
    "DNT": "1"
  }
};

if (typeof $argument !== "undefined") {
  if ($argument.username) CONFIG.username = String($argument.username);
  if ($argument.password) CONFIG.password = String($argument.password);
  if ($argument.notifyOnSuccess !== undefined) {
    CONFIG.notifyOnSuccess = String($argument.notifyOnSuccess) === "true";
  }
  if ($argument.notifyOnFailure !== undefined) {
    CONFIG.notifyOnFailure = String($argument.notifyOnFailure) === "true";
  }
  if ($argument.throttleSec) {
    const parsed = parseInt(String($argument.throttleSec), 10);
    if (!isNaN(parsed) && parsed >= 0) {
      CONFIG.successNotifyThrottleSec = parsed;
    }
  }
}

const STORE_KEYS = {
  lastNotifyTime: "seu_loon_last_success_notify_time",
  lastNotifySig: "seu_loon_last_success_notify_sig"
};

function log(msg) {
  console.log("[SEU-Loon] " + msg);
}

function done(msg) {
  if (msg) log(msg);
  $done();
}

function notify(title, subtitle, content, attach) {
  try {
    $notification.post(title, subtitle || "", content || "", attach);
  } catch (e) {
    log("通知失败: " + e);
  }
}

function readStore(key) {
  try {
    return $persistentStore.read(key) || "";
  } catch (e) {
    return "";
  }
}

function writeStore(key, value) {
  try {
    return $persistentStore.write(String(value), key);
  } catch (e) {
    return false;
  }
}

function getConfig() {
  try {
    const raw = $config.getConfig();
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    log("读取配置失败: " + e);
    return {};
  }
}

function getSSID() {
  const conf = getConfig();
  return conf && conf.ssid ? String(conf.ssid).trim() : "";
}

function isTargetSSID(ssid) {
  if (!ssid) return false;
  if (CONFIG.targetSSIDs.indexOf(ssid) !== -1) return true;
  return ssid.indexOf(CONFIG.targetPrefix) === 0;
}

function normalizeMac(mac) {
  return String(mac || "").replace(/[:-]/g, "").trim().toUpperCase();
}

function extractIPv4(text) {
  const match = String(text || "").match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  return match ? match[0] : "";
}

function hex16ToIPv4(hex) {
  const clean = String(hex || "").trim();
  if (!/^[0-9a-fA-F]{8}$/.test(clean)) return "";
  const parts = [];
  for (let i = 0; i < 8; i += 2) {
    parts.push(parseInt(clean.substr(i, 2), 16));
  }
  return parts.join(".");
}

function buildQuery(params) {
  return Object.keys(params)
    .map(k => encodeURIComponent(k) + "=" + encodeURIComponent(params[k]))
    .join("&");
}

function buildUrl(base, params) {
  return base + "?" + buildQuery(params);
}

function httpGet(paramsOrUrl) {
  const params = typeof paramsOrUrl === "string"
    ? { url: paramsOrUrl, headers: CONFIG.headers, timeout: 8000 }
    : Object.assign({ headers: CONFIG.headers, timeout: 8000 }, paramsOrUrl);

  return new Promise((resolve, reject) => {
    $httpClient.get(params, (error, response, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({
        status: response && response.status,
        headers: response && response.headers,
        body: data || ""
      });
    });
  });
}

function parseJsonp(text) {
  if (!text) return {};
  let payload = String(text).trim();
  const match = payload.match(/^[^(]+\(([\s\S]*)\)\s*;?\s*$/);
  if (match) payload = match[1];
  try {
    return JSON.parse(payload);
  } catch (e) {
    log("JSONP 解析失败: " + payload.slice(0, 200));
    return {};
  }
}

function isOnlinePayload(payload) {
  const result = String((payload && payload.result) || "").trim().toLowerCase();
  return result === "1" || result === "ok";
}

function isLoginSuccess(body, payload) {
  const result = String((payload && payload.result) || "").trim().toLowerCase();
  const retCode = String((payload && payload.ret_code) || "").trim();
  if (result === "1" || result === "ok" || retCode === "0") return true;

  const markers = [
    '"ret_code":"0"',
    'ALREADY_LOGIN',
    '已经登录',
    '登录成功',
    '成功登录',
    '\\u6210\\u529f'
  ];

  const text = String(body || "");
  return markers.some(marker => text.indexOf(marker) !== -1);
}

async function fetchJsVersion() {
  try {
    const res = await httpGet(CONFIG.urlJsVersion);
    const match = String(res.body || "").match(/jsVersion='([^']+)'/);
    if (match && match[1]) {
      log("jsVersion=" + match[1]);
      return match[1];
    }
  } catch (e) {
    log("获取 jsVersion 失败: " + e);
  }
  return CONFIG.jsVersionFallback;
}

async function getIP() {
  return "";
}

async function fetchTerminalInfo() {
  for (const url of CONFIG.chkStatusUrls) {
    try {
      const res = await httpGet({ url, timeout: 6000 });
      const payload = parseJsonp(res.body);
      log("chkstatus 响应(" + url + "): " + String(res.body).slice(0, 200));

      const ip =
        payload.v46ip ||
        payload.v4ip ||
        payload.ss5 ||
        (payload.ss3 ? hex16ToIPv4(payload.ss3) : "") ||
        extractIPv4(res.body);

      const mac = normalizeMac(payload.ss4 || payload.olmac || payload.usermac || payload.mac || "");

      if (ip || mac) {
        return { ip: String(ip || "").trim(), mac };
      }
    } catch (e) {
      log("chkstatus 请求失败: " + url + " err=" + e);
    }
  }

  return { ip: "", mac: "" };
}

async function buildContext() {
  const ssid = getSSID();
  const term = await fetchTerminalInfo();
  const jsVersion = await fetchJsVersion();
  return { ssid, mac: term.mac, ip: term.ip || await getIP(), jsVersion };
}

async function checkOnlineStatus(ctx) {
  const params = {
    callback: "dr1001",
    c: "Portal",
    a: "online_list",
    user_account: "drcom",
    user_password: "123",
    wlan_user_mac: ctx.mac,
    wlan_user_ip: ctx.ip,
    curr_user_ip: ctx.ip,
    jsVersion: ctx.jsVersion,
    v: String(Math.floor(Math.random() * 9000 + 1000))
  };

  const res = await httpGet(buildUrl(CONFIG.urlLogin, params));
  log("状态检查响应: " + String(res.body).slice(0, 200));
  const payload = parseJsonp(res.body);
  return isOnlinePayload(payload);
}

async function loginOnce(ctx, suffix, ispName) {
  const params = {
    user_account: ",0," + CONFIG.username + suffix,
    user_password: CONFIG.password,
    c: "Portal",
    a: "login",
    callback: "dr1003",
    login_method: "1",
    wlan_user_ip: ctx.ip,
    wlan_user_ipv6: "",
    wlan_user_mac: ctx.mac,
    wlan_ac_ip: "",
    wlan_ac_name: "",
    jsVersion: ctx.jsVersion,
    v: String(Math.floor(Math.random() * 9000 + 1000))
  };

  log("尝试登录: ssid=" + ctx.ssid + ", isp=" + ispName);
  const res = await httpGet(buildUrl(CONFIG.urlLogin, params));
  const payload = parseJsonp(res.body);
  return {
    ok: isLoginSuccess(res.body, payload),
    ispName,
    suffix,
    body: res.body,
    payload
  };
}

async function tryLogin(ctx) {
  if (ctx.ssid === "SEU-ISP") {
    for (const item of CONFIG.ispCycle) {
      const ret = await loginOnce(ctx, item.suffix, item.name);
      if (ret.ok) return ret;
    }
    return { ok: false, ispName: "", suffix: "", body: "SEU-ISP 全部运营商尝试失败" };
  }

  return await loginOnce(ctx, "", "校园网");
}

function shouldThrottleSuccessNotify(ctx, ispName) {
  const now = Math.floor(Date.now() / 1000);
  const sig = [ctx.ssid, ispName, ctx.ip].join("|");
  const lastTime = parseInt(readStore(STORE_KEYS.lastNotifyTime) || "0", 10);
  const lastSig = readStore(STORE_KEYS.lastNotifySig);
  if (lastSig === sig && now - lastTime < CONFIG.successNotifyThrottleSec) {
    return true;
  }
  writeStore(STORE_KEYS.lastNotifyTime, now);
  writeStore(STORE_KEYS.lastNotifySig, sig);
  return false;
}

function notifySuccess(ctx, ispName) {
  if (!CONFIG.notifyOnSuccess) return;
  if (shouldThrottleSuccessNotify(ctx, ispName)) {
    log("命中成功通知节流，跳过通知");
    return;
  }
  notify(
    "SEU 校园网登录成功",
    "SSID: " + ctx.ssid,
    "运营商: " + ispName + "\nIP: " + ctx.ip
  );
}

function notifyFailure(ctx, msg) {
  if (!CONFIG.notifyOnFailure) return;
  notify(
    "SEU 校园网登录失败",
    "SSID: " + ctx.ssid,
    msg || "请检查账号、密码、MAC 或网络状态"
  );
}

(async function main() {
  try {
    const ssid = getSSID();
    if (!isTargetSSID(ssid)) {
      done("当前非 SEU Wi-Fi，跳过");
      return;
    }

    const ctx = await buildContext();
    log("当前环境 ssid=" + ctx.ssid + ", ip=" + ctx.ip + ", mac=" + ctx.mac);

    if (!ctx.mac) {
      notify(
        "SEU 校园网脚本",
        "无法获取终端 MAC",
        "请确认当前已连接校园网，并检查 chkstatus 接口是否可用"
      );
      done("缺少 MAC");
      return;
    }

    if (!ctx.ip) {
      notify("SEU 校园网脚本", "无法获取 IPv4", "请检查当前网络环境");
      done("无法获取 IPv4");
      return;
    }

    const online = await checkOnlineStatus(ctx);
    if (online) {
      done("已在线，无需登录");
      return;
    }

    const loginRet = await tryLogin(ctx);
    if (loginRet.ok) {
      notifySuccess(ctx, loginRet.ispName);
      done("登录成功: " + loginRet.ispName);
      return;
    }

    log("登录失败: " + String(loginRet.body || ""));
    notifyFailure(ctx, "SSID: " + ctx.ssid + "\n已尝试登录但未成功");
    done("登录失败");
  } catch (e) {
    log("脚本异常: " + e);
    notify("SEU 校园网脚本", "脚本异常", String(e));
    done("脚本异常");
  }
})();

/*
Loon 配置示例：

[Script]
cron "*/3 * * * *" script-path=/path/to/seu_auto_login.js,tag=SEU自动登录,enable=true
network-changed script-path=/path/to/seu_auto_login.js,tag=SEU网络变化登录,enable=true

建议：
1. 可同时配置 cron + network-changed
2. 确保 w.seu.edu.cn 走 DIRECT
3. 如使用远程脚本，可把 script-path 改成你的 raw 链接
*/
