/*********************************
 * Loon Test Script
 * 用于验证：
 * 1. 插件是否成功触发脚本
 * 2. 远程/本地 script-path 是否正确
 * 3. Loon 本地通知是否正常
 *********************************/

const CONFIG = {
  debug: false,
  title: "Loon 实验插件",
  subtitle: "脚本已成功运行",
  content: "如果你看到了这条通知，说明插件触发、脚本加载、通知能力都正常。"
};

if (typeof $argument !== "undefined") {
  if ($argument.debug !== undefined) {
    CONFIG.debug = String($argument.debug) === "true";
  }
  if ($argument.title) CONFIG.title = String($argument.title);
  if ($argument.subtitle) CONFIG.subtitle = String($argument.subtitle);
  if ($argument.content) CONFIG.content = String($argument.content);
}

function log(msg) {
  console.log("[Loon-Test] " + msg);
}

function notify(title, subtitle, content) {
  try {
    $notification.post(title, subtitle || "", content || "");
  } catch (e) {
    log("通知失败: " + e);
  }
}

(function main() {
  try {
    const scriptName = ($script && $script.name) ? $script.name : "unknown";
    const now = new Date().toLocaleString();

    log("测试脚本启动 script=" + scriptName + " time=" + now);

    let content = CONFIG.content + "\n\n脚本名: " + scriptName + "\n时间: " + now;

    if (CONFIG.debug) {
      let ssid = "";
      try {
        const conf = $config.getConfig();
        const parsed = typeof conf === "string" ? JSON.parse(conf) : conf;
        ssid = parsed && parsed.ssid ? parsed.ssid : "<empty>";
      } catch (e) {
        ssid = "<read failed>";
      }
      content += "\nSSID: " + ssid;
    }

    notify(CONFIG.title, CONFIG.subtitle, content);
    $done();
  } catch (e) {
    notify("Loon 实验插件", "脚本异常", String(e));
    $done();
  }
})();
