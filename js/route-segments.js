/*
 * RouteWeather · along-route geometry helpers
 * Split the original road geometry by cumulative distance. This module does
 * not create weather samples; it only assigns each existing sample to the
 * section of route it represents.
 */
(function (root) {
  'use strict';

  const EARTH_RADIUS_M = 6371008.8;

  function distance(a, b) {
    const rad = value => value * Math.PI / 180;
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const lat1 = rad(a.lat), lat2 = rad(b.lat);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)));
  }

  function cumulativeDistances(coords) {
    if (!Array.isArray(coords) || !coords.length) return [];
    const out = [0];
    for (let i = 1; i < coords.length; i++) {
      out.push(out[i - 1] + distance(coords[i - 1], coords[i]));
    }
    return out;
  }

  function atDistance(coords, cumulative, target) {
    const last = coords.length - 1;
    if (target <= 0) return { lat: coords[0].lat, lon: coords[0].lon };
    if (target >= cumulative[last]) return { lat: coords[last].lat, lon: coords[last].lon };

    let i = 0;
    while (i < last - 1 && cumulative[i + 1] < target) i++;
    const span = cumulative[i + 1] - cumulative[i];
    const ratio = span > 0 ? (target - cumulative[i]) / span : 0;
    return {
      lat: coords[i].lat + (coords[i + 1].lat - coords[i].lat) * ratio,
      lon: coords[i].lon + (coords[i + 1].lon - coords[i].lon) * ratio,
    };
  }

  function sliceByDistance(coords, cumulative, start, end) {
    const first = atDistance(coords, cumulative, start);
    const last = atDistance(coords, cumulative, end);
    const out = [first];
    for (let i = 1; i < coords.length - 1; i++) {
      if (cumulative[i] > start && cumulative[i] < end) {
        out.push({ lat: coords[i].lat, lon: coords[i].lon });
      }
    }
    out.push(last);
    return out;
  }

  /**
   * Return contiguous, distance-based sections over the original route line.
   * Each section spans the midpoint between neighboring weather samples.
   */
  function buildSegments(coords, samples) {
    if (!Array.isArray(coords) || coords.length < 2) return [];
    const cumulative = cumulativeDistances(coords);
    const total = cumulative[cumulative.length - 1];
    if (!(total > 0)) return [];

    const ordered = (samples || []).map((point, index) => {
      const km = Number(point && point.cumKm);
      const ratio = Number(point && point.ratio);
      const meters = Number.isFinite(km) ? km * 1000
        : Number.isFinite(ratio) ? ratio * total : null;
      return meters == null ? null : {
        point,
        index,
        distance: Math.max(0, Math.min(total, meters)),
      };
    }).filter(Boolean).sort((a, b) => a.distance - b.distance);

    if (!ordered.length) {
      return [{ index: -1, point: null, level: 'neutral', startM: 0, endM: total, coords: coords.slice() }];
    }

    const bounds = [0];
    for (let i = 0; i < ordered.length - 1; i++) {
      bounds.push((ordered[i].distance + ordered[i + 1].distance) / 2);
    }
    bounds.push(total);

    const out = [];
    for (let i = 0; i < ordered.length; i++) {
      const startM = bounds[i];
      const endM = bounds[i + 1];
      if (endM - startM < 0.01) continue;
      const item = ordered[i];
      out.push({
        index: item.index,
        point: item.point,
        level: item.point && item.point.level ? item.point.level.key : 'neutral',
        startM,
        endM,
        coords: sliceByDistance(coords, cumulative, startM, endM),
      });
    }
    return out;
  }

  root.RouteWeatherSegments = { distance, cumulativeDistances, atDistance, sliceByDistance, buildSegments };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RouteWeatherSegments;
})(typeof globalThis !== 'undefined' ? globalThis : window);
