# RouteWeather 2.0 · 山途智行

面向山地自驾、骑行与徒步的路线天气分析工具。把路网里程、预计到达时刻、逐小时天气预报、海拔与沿途风险放在同一张路线图上，帮助在出发前看清每一段山路。

- 在线地址：<https://xzl2007.github.io/route-weather/>
- 纯静态站点，无需构建、无需后端
- 手机与电脑自适应
- 行程数据只保存在当前设备

## 功能

### 路线规划
- 全国地名、区县、景区搜索，支持同名地点多结果选择
- 自驾 / 徒步 / 骑行三种出行方式
- 起点、途经点、终点最多 5 个点位
- 手机端按住左侧「⋮⋮」上下拖动，即可调整点位顺序
- 规划模式与导航模式两套分析流程
- 自动计算路网距离、预计用时、分段导航

### 路线与地图
- Leaflet 1.9.4 本地化，天地图底图（普通 / 地形 / 影像）
- 路线按天气影响分段着色
- 点击路段直接弹出该段评分、天气、气温、降水、风力、海拔与扣分原因
- 自驾路线支持「时间优先 / 少高速 / 风景优先」等备选方案
- 地图全屏模式
- 风险点只标注真正经过当前路线的位置

### 天气与报告
- 沿途等距采样天气，按预计经过时刻取预报
- 逐小时天气卡片
- 路线天气评分、关注采样点、影响原因
- 智能行程报告：
  - 出行结论与推荐出发时段
  - 未来出发时段对比
  - 行程注意事项
  - 沿途重点路段
  - 山地气象关注路段
  - 山地地形剖面
  - 沿途推荐
  - 沿途补能
  - 穿衣、户外防护、含氧量建议
- 报告章节支持收起 / 展开，底部提供「回到顶部」
- 推荐出发时段在同一条路线、同一种出行方式下保持稳定，避免反复体检时跳变

### 沿途推荐
- 景点、美食、住宿三类地点
- 根据出行方式、预计经过时段与绕行距离排序
- 加油站、充电站单独分区，可按类型筛选
- 每个地点支持：
  - 高德地图导航
  - 腾讯地图导航
  - 百度地图导航
  - 大众点评
  - 去哪儿
- 地点信息来自天地图 POI，可选配置高德地图 Web 服务 Key 提升覆盖

### 可读性
- 统一手机与桌面字号层级
- 手机端大字号、卡片化沿途天气、可拖拽点位
- 桌面端时间轴卡片、对齐的统计信息与导航按钮
- 支持高对比系统设置

## 技术栈

- 原生 HTML / CSS / JavaScript，无构建步骤
- Leaflet 1.9.4（本地 `vendor/leaflet`）
- 天气与海拔：Open-Meteo（含 SRTM 高程采样）
- 地名 / POI / 底图：天地图
- 路线规划：
  - 自驾：Valhalla，失败回退 OSRM
  - 骑行 / 徒步：BRouter
- 可选：高德地图 Web 服务 Key（地点补充）

## 目录结构

```text
.
├── index.html                     # 单页入口
├── manifest.webmanifest           # PWA 清单
├── sw.js                          # Service Worker
├── .nojekyll                      # GitHub Pages 禁用 Jekyll
├── css/
│   ├── style.css                  # 基础样式
│   ├── redesign.css               # 视觉改版
│   ├── product-ui.css             # 产品界面
│   ├── immersive-ui.css           # 地图 / 报告沉浸式界面
│   ├── readability.css            # 可读性覆盖
│   └── typography-consistency.css # 统一字号层级
├── js/
│   ├── app.js                     # 页面状态、报告、交互
│   ├── map.js                     # Leaflet 地图与路线绘制
│   ├── routing.js                 # Valhalla / OSRM / BRouter
│   ├── geocode.js                 # 天地图地名搜索
│   ├── poi.js                     # 沿途地点与补能站点
│   ├── scoring.js                 # 天气评分、穿衣、含氧量
│   ├── mountain.js                # 山地气象与地形剖面
│   ├── route-segments.js          # 路线分段
│   ├── points.js                  # 内置地点库
│   ├── api.js                     # 天气接口
│   ├── storage.js                 # 本地存储
│   └── config.js                  # 天地图 Key 等配置
├── assets/
│   └── hero-alpine.webp           # 首页 / 报告背景图
├── icons/
└── vendor/leaflet/
```

## 本地运行

不能直接双击 `index.html`（`file://` 下接口和 Service Worker 会受限）。在项目根目录启动一个静态服务器：

```powershell
python -m http.server 8080
```

然后打开 <http://127.0.0.1:8080/>。

## 部署到 GitHub Pages

1. 把本目录内容上传到仓库 `xzl2007/route-weather` 的 `main` 分支根目录。
2. 确认根目录包含 `.nojekyll`。
3. 在仓库 **Settings → Pages** 中选择 `main` 分支、`/ (root)`。
4. 等待 1–3 分钟，访问 <https://xzl2007.github.io/route-weather/>。

> 不要直接上传 zip 压缩包，GitHub Pages 不会自动解压。解压后上传里面的文件和文件夹。

### 更新后强制刷新

- 页面脚本：`js/app.js?v=73`
- 地图脚本：`js/map.js?v=36`
- 统一字号：`css/typography-consistency.css?v=13`
- Service Worker：`rwc-shell-v122`

如果手机仍显示旧版，关闭旧标签页重新打开，或在浏览器设置中清除该站点缓存。

## 数据与隐私

- 不需要注册或登录。
- 行程、收藏与展开状态保存在浏览器 `localStorage`。
- 天气、地名、路线请求会发送到对应公共服务；不会上传账号密码。
- 可选高德 Key 只保存在当前浏览器 `localStorage`。
- POI 推荐会跳转第三方地图 / 点评网站，其内容与可用性由第三方负责。

## 使用边界

- 天气评分用于比较不同出发时段和路段的天气影响，不是道路安全认证。
- 到达时刻按平均速度与路网时长估算，未考虑堵车、休息、封路、施工。
- 高风险点依据公开山区道路安全提示与天气风险整理，不是官方事故统计。
- 山区加油站、充电站营业时间、油品、桩数请以现场为准。
- 出行安全以当地交警、应急管理和官方预警为准。

## 版本

- RouteWeather 2.0
- 当前界面版本：`app.js?v=73`
- 当前地图版本：`map.js?v=36`
- 当前 Service Worker：`rwc-shell-v122`

## 致谢

- [Open-Meteo](https://open-meteo.com/)：天气与高程数据（CC BY 4.0）
- [天地图](https://www.tianditu.gov.cn/)：底图、地名与 POI
- [OpenStreetMap](https://www.openstreetmap.org/)：路网数据
- [Leaflet](https://leafletjs.com/)：地图引擎
- Valhalla、OSRM、BRouter：路线规划服务
