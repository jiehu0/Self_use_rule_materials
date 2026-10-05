# Loon DNS 分流：GetSomeFries + ChinaDomain

将 [GetSomeFries 的 DNS 服务器选择规则](https://github.com/VirgilClyne/GetSomeFries/blob/main/plugin/DNS.plugin) 与 Egern 使用的 [Repcz ChinaDomain 名单](https://github.com/Repcz/Tool/blob/X/Egern/Rules/ChinaDomain.yaml) 合并到一个 Loon 插件。重叠域名优先保留 GetSomeFries 指定的 DNS。

| 匹配情况 | DNS |
| --- | --- |
| `seu.edu.cn` 及其子域名（校园网例外） | 系统 DNS |
| 命中 GetSomeFries 的有效 DNS 映射 | 使用该映射指定的 DNS |
| 其余命中 ChinaDomain 的域名、后缀或关键词 | `223.5.5.5` |
| 未命中 | 沿用主配置默认 DNS |

例如：抖音使用 `180.184.1.1`，QQ 使用腾讯 DoH，淘宝使用阿里 DoH；GetSomeFries 未覆盖的 B 站首页和图片域名由国内名单补充，使用 `223.5.5.5`。iCloud、台湾地区等海外 DNS 映射也保留。GetSomeFries 中已注释的条目不启用。

插件不是流量代理规则，不决定 DIRECT 或节点选择。它也不会设置全局 DNS。若主配置使用下列设置，未命中域名就仍使用 Cloudflare / Google DoH；已开启“查询回落”时，加密查询失败后使用 `223.5.5.5`。

```ini
[General]
dns-server = 223.5.5.5
doh-server = https://cloudflare-dns.com/dns-query,https://dns.google/dns-query
```

## 安装

在 Loon 添加并启用此插件 URL：

```text
https://raw.githubusercontent.com/jiehu0/Self_use_rule_materials/main/loon/ChinaDomain_DNS.plugin
```

或者在主配置已有的 `[Plugin]` 段添加：

```ini
https://raw.githubusercontent.com/jiehu0/Self_use_rule_materials/main/loon/ChinaDomain_DNS.plugin, enabled=true
```

先停用原版 GetSomeFries DNS enhanced 等重叠的 DNS 映射插件，只启用这一个合并版。原来的 `ChinaDomain_DNS.plugin` 订阅地址保持不变，已有订阅更新后即获得合并版，不需要重复添加。保留原有代理规则、广告过滤规则及校园网映射。重新加载配置、重连 Loon，再验证 DNS 记录中的服务器；浏览器已有连接或缓存可能仍使用旧地址。

上游名单含 `edu.cn`。为延续现有校园网设置，插件将 `seu.edu.cn` 和 `*.seu.edu.cn` 的系统 DNS 例外放在国内通配规则前；不要删除该例外后再依赖重叠插件之间的匹配优先级。

## 与 Egern 的对应关系

- `domain_set` → 精确 Host 映射。
- `domain_suffix_set` → 根域名及 `*.域名`，同时覆盖根域名和任意层级子域名。
- `domain_keyword_set` → `*关键词*`。
- 国际化域名转换为 ASCII/Punycode，重复映射去重。
- IP 段和 User-Agent 无法用于解析前的域名匹配，不转换；生成文件头会记录数量。
- 不复制 Egern 的 Reject 规则或 `proxy_nameservers` 节点专用 DNS。现有拦截、节点解析仍由主配置和其他规则处理。

因此复现的是“国内名单指定 DNS，其他域名使用默认 DNS”的核心逻辑，并在此之上优先采用 GetSomeFries 的专用 DNS，并非完整移植 Egern DNS 引擎。名单代表上游维护者的分类，包含部分国际服务域名，不能理解为严格的服务器地理位置判定。

## 合并范围与冲突处理

- 导入 GetSomeFries `[Host]` 中有效的 `server:` 规则，并保留这些规则使用的 DoH 服务器自身的固定 IP（如 `doh.pub`），避免引导解析依赖。Google 消息服务等普通应用的固定目标 IP 不复制；主配置已有的 DoH 服务器固定 IP 映射继续保留。
- 同名映射去重，保留 GetSomeFries 的值。
- 国内名单中更具体的域名也继承已匹配的 GetSomeFries DNS。例如 `*.qq.com` 指定腾讯 DoH 时，名单中的 `api.qq.com` 或 `*.wx.qq.com` 不再生成阿里 DNS 覆盖。
- 对 `*.aliyun.*`、`*.bytedance.*` 等通配模式同样执行继承。
- GetSomeFries 的规则排列在国内补充规则之前；校园网例外最先输出。特殊交叉通配符在不同 Loon 版本中的运行时匹配仍需以 DNS 记录验证，不能仅靠文件顺序推断。

## 更新名单

生成器只使用 Python 3 标准库；不在 Loon 内运行脚本。它下载两个上游文件，严格读取当前格式；遇到未知字段、重复 DNS 映射或新增非预期配置段会失败，保留原插件。

在仓库根目录执行：

```sh
python3 loon/dns/generate.py
python3 -m unittest discover -s loon/dns -p 'test_*.py' -v
```

需要离线生成时：

```sh
python3 loon/dns/generate.py --source /path/to/ChinaDomain.yaml --fries-source /path/to/DNS.plugin
```

检查并提交更新后的 `loon/ChinaDomain_DNS.plugin`，然后在 Loon 更新该插件。Loon 下载的是仓库中已生成的合并快照，不会自行读取或转换两个上游文件。本仓库未设置定时更新任务。

生成文件附带两个上游 URL、SHA-256、条目数量和完整许可。合并插件是对 GetSomeFries 的修改版本，署名 VirgilClyne 并按 GPL-3.0 分发；Repcz 的规则保留 MIT 许可。许可副本见 [GetSomeFries-LICENSE.txt](GetSomeFries-LICENSE.txt) 和 [Repcz-LICENSE.txt](Repcz-LICENSE.txt)。

## 验证范围

生成器测试检查域名边界、根域名与子域名、关键词、国际化域名、重叠规则继承、校园网例外、注释与固定 IP 排除、无匹配回落及格式异常。测试通过不代表已在每个 Loon 版本验证加载性能或运行时匹配优先级；以实际启用后的 DNS 记录为准。

Loon 官方语法参考：[DNS 映射](https://nsloon.app/docs/DNS/hostmap/)。
