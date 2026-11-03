/* 沿途地点推荐测试（离线、合成数据） */
const path = require('path');
const POI = require(path.join(__dirname, '..', 'js', 'poi.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra != null ? '  (' + extra + ')' : '')); }
}

const coords = [
  { lat: 30, lon: 103 },
  { lat: 30, lon: 103.05 },
  { lat: 30, lon: 103.1 },
];

console.log('\n【用例1】地点到路线的距离与里程');
{
  const metrics = POI.routeMetrics(coords);
  ok('路线总长大于 9 km', metrics.totalM > 9000, metrics.totalM);
  const near = POI.nearestOnRoute({ lat: 30.01, lon: 103.05 }, metrics);
  ok('横向 1.1 km 点位被识别', near.distanceM > 1000 && near.distanceM < 1200, near.distanceM);
  ok('路线里程接近中点', Math.abs(near.routeKm - metrics.totalM / 2000) < 0.1, near.routeKm);
  const far = POI.nearestOnRoute({ lat: 31, lon: 104 }, metrics);
  ok('远处点位距离明显更大', far.distanceM > near.distanceM);
}

console.log('\n【用例2】搜索响应清洗与分类');
{
  const payload = { pois: [
    { name: '碧峰峡旅游景区', lonlat: '102.99,30.02', address: '雅安', hotPointID: 'a1' },
    { name: '景点管理委员会', lonlat: '102.98,30.01' },
    { name: '桂园酒店', lonlat: '102.97,30.03' },
    { name: '普通杂货铺', lonlat: '102.96,30.04' },
  ] };
  const attractions = POI.normalizeResponse(payload, 'attraction');
  ok('保留真实景点', attractions.some(x => x.name === '碧峰峡旅游景区'));
  ok('过滤管理委员会等非景点', !attractions.some(x => x.name.includes('管理委员会')));
  const lodging = POI.normalizeResponse(payload, 'lodging');
  ok('识别酒店', lodging.some(x => x.name === '桂园酒店'));
  ok('酒店类别不会混入普通杂货铺', !lodging.some(x => x.name === '普通杂货铺'));
  const deduped = POI.dedupe([...attractions, ...attractions]);
  ok('同名同坐标去重', deduped.length === 1, deduped.length);
}

console.log('\n【用例3】按绕行距离筛选');
{
  const metrics = POI.routeMetrics(coords);
  const items = [
    { name: 'A', category: 'food', lat: 30.005, lon: 103.03 },
    { name: 'B', category: 'food', lat: 30.1, lon: 103.03 },
  ];
  const near = POI.enrichNearRoute(items, metrics, 1500, 20);
  ok('半径内保留 A', near.some(x => x.name === 'A'));
  ok('半径外过滤 B', !near.some(x => x.name === 'B'));
  ok('结果带路线里程', near[0] && Number.isFinite(near[0].routeKm));
}

console.log('\n【用例4】出行方式与时段排序');
{
  const food = { name: '山野餐厅', category: 'food', lat: 30, lon: 103.02, distanceM: 180, routeKm: 2, routeRatio: 0.2 };
  const supply = { name: '中途加油站', category: 'fuel', lat: 30, lon: 103.05, distanceM: 250, routeKm: 50, routeRatio: 0.5 };
  const lodging = { name: '终点民宿', category: 'lodging', lat: 30, lon: 103.09, distanceM: 220, routeKm: 8, routeRatio: 0.8 };
  const attraction = { name: '河谷观景台', category: 'attraction', lat: 30, lon: 103.06, distanceM: 320, routeKm: 6, routeRatio: 0.6 };
  const foodResult = POI.personalize([food], { mode: 'drive', totalKm: 100, durationMin: 120, startMinute: 11 * 60 });
  ok('午餐时段美食获得标签', foodResult.items[0].tags.includes('午餐时段'), JSON.stringify(foodResult.items[0].tags));
  const lodgingResult = POI.personalize([lodging], { mode: 'drive', totalKm: 10, durationMin: 360, startMinute: 16 * 60 });
  ok('傍晚终点住宿获得落脚标签', lodgingResult.items[0].tags.includes('适合落脚'), lodgingResult.items[0].reason);
  const supplyResult = POI.personalize([supply], { mode: 'drive', totalKm: 100, durationMin: 120, startMinute: 8 * 60 });
  ok('长途中段补给获得标签', supplyResult.items[0].tags.includes('长途中段补给'), supplyResult.items[0].reason);
  const hikeResult = POI.personalize([attraction], { mode: 'hike', totalKm: 20, durationMin: 300, startMinute: 9 * 60 });
  ok('徒步路线景点可推荐', hikeResult.items.length === 1 && hikeResult.modeLabel === '徒步');
  ok('徒步配置不请求加油站或充电站', !POI.MODE_SETTINGS.hike.queries.fuel && !POI.MODE_SETTINGS.hike.queries.charging);
}

console.log('\n【用例5】路线包围盒');
{
  const bounds = POI.buildBounds(coords, 2000);
  ok('包围盒覆盖起点', bounds.west < 103 && bounds.east > 103);
  ok('包围盒覆盖终点', bounds.west < 103.1 && bounds.east > 103.1);
  ok('MapBound 为四段坐标', bounds.mapBound.split(',').length === 4);
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
