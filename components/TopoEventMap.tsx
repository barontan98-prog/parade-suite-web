"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    L?: any;
  }
}

export type TopoMapMarker = {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  detail?: string;
  kind: "team" | "station" | "current" | "safety";
  heading?: number | null;
  markerText?: string;
};

type RasterBackground = {
  imageUrl: string;
  southWest: { latitude: number; longitude: number };
  northEast: { latitude: number; longitude: number };
};

type Props = {
  markers: TopoMapMarker[];
  center?: { latitude: number; longitude: number } | null;
  zoom?: number;
  heightClass?: string;
  onMapClick?: (latitude: number, longitude: number) => void;
  rasterBackground?: RasterBackground | null;
};

const CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

function loadLeaflet() {
  return new Promise<any>((resolve, reject) => {
    if (window.L) {
      resolve(window.L);
      return;
    }

    if (!document.querySelector(`link[href="${CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = CSS;
      document.head.appendChild(link);
    }

    const existing = document.querySelector(`script[src="${JS}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(window.L), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = JS;
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

function installStyle() {
  const existing = document.getElementById("event-command-live-map-css");
  if (existing) existing.remove();

  const style = document.createElement("style");
  style.id = "event-command-live-map-css";
  style.textContent = `
    .event-command-live-map .leaflet-container {
      background: #f6f2d6;
      font-family: Arial, sans-serif;
    }

    .event-command-live-map .station-label {
      background: rgba(255,255,255,.96);
      border: 2px solid #342e57;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,.16);
      color: #342e57;
      font-weight: 900;
      padding: 4px 7px;
    }

    .event-command-live-map .station-label::before {
      display: none;
    }

    .event-command-live-map .team-arrow-wrap,
    .event-command-live-map .station-pin-wrap,
    .event-command-live-map .safety-marker-wrap {
      background: transparent;
      border: 0;
    }

    .event-command-live-map .team-arrow {
      width: 52px;
      height: 50px;
      filter: drop-shadow(0 2px 3px rgba(0,0,0,.34));
    }

    .event-command-live-map .team-arrow svg {
      display: block;
      width: 52px;
      height: 50px;
      overflow: visible;
    }

    .event-command-live-map .team-arrow path {
      fill: #10b981;
      stroke: #064e3b;
      stroke-width: 2.2;
      stroke-linejoin: round;
    }

    .event-command-live-map .station-pin {
      width: 44px;
      height: 70px;
      filter: drop-shadow(0 2px 3px rgba(0,0,0,.28));
    }

    .event-command-live-map .station-pin svg {
      display: block;
      width: 44px;
      height: 70px;
      overflow: visible;
    }

    .event-command-live-map .leaflet-tooltip {
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,.16);
      font-weight: 700;
    }

    .event-map-key {
      background: rgba(255,255,255,.95);
      border: 2px solid #111827;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,.15);
      color: #111827;
      padding: 8px 10px;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.45;
    }

    .event-map-key strong {
      display: block;
      margin-bottom: 3px;
      font-size: 12px;
    }

    .event-map-north {
      width: 38px;
      padding: 5px 0;
      background: rgba(255,255,255,.95);
      border: 2px solid #111827;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,.15);
      color: #111827;
      text-align: center;
      font-weight: 900;
    }
  `;
  document.head.appendChild(style);
}

function currentArrowIcon(L: any) {
  return L.divIcon({
    className: "team-arrow-wrap",
    iconSize: [52, 50],
    iconAnchor: [26, 50],
    tooltipAnchor: [0, -48],
    html: `
      <div class="team-arrow">
        <svg viewBox="0 0 52 50" aria-hidden="true">
          <path d="M26 49 L4 4 L26 14 L48 4 Z" />
        </svg>
      </div>
    `,
  });
}

function locationPinIcon(
  L: any,
  text: string,
  fill: string,
  stroke: string,
  textColor: string
) {
  const safeText = String(text || "").slice(0, 4).replace(/[<>&"]/g, "");
  return L.divIcon({
    className: "team-location-pin-wrap",
    iconSize: [52, 68],
    iconAnchor: [26, 67],
    tooltipAnchor: [0, -64],
    html: `
      <div style="width:52px;height:68px;filter:drop-shadow(0 3px 4px rgba(0,0,0,.28))">
        <svg viewBox="0 0 52 68" width="52" height="68" aria-hidden="true">
          <path
            d="M26 66 C22 58 5 42 5 25 C5 13.4 14.4 4 26 4 C37.6 4 47 13.4 47 25 C47 42 30 58 26 66 Z"
            fill="${fill}"
            stroke="${stroke}"
            stroke-width="3"
          />
          <circle cx="26" cy="25" r="14" fill="${fill}" stroke="${stroke}" stroke-width="2" />
          <text
            x="26"
            y="30"
            text-anchor="middle"
            font-family="Arial, sans-serif"
            font-size="${safeText.length > 2 ? 12 : 16}"
            font-weight="900"
            fill="${textColor}"
          >${safeText}</text>
        </svg>
      </div>
    `,
  });
}

function teamPinIcon(L: any, text: string) {
  return locationPinIcon(L, text, "#fdf4e5", "#342e57", "#342e57");
}

function stationPinIcon(L: any) {
  return L.divIcon({
    className: "station-pin-wrap",
    iconSize: [44, 70],
    iconAnchor: [22, 69],
    tooltipAnchor: [0, -67],
    html: `
      <div class="station-pin">
        <svg viewBox="0 0 44 70" aria-hidden="true">
          <line x1="22" y1="31" x2="22" y2="68"
            stroke="#808080" stroke-width="6" stroke-linecap="round" />
          <circle cx="22" cy="20" r="18"
            fill="#342e57" stroke="#241f3d" stroke-width="2" />
          <circle cx="28" cy="14" r="5"
            fill="rgba(255,255,255,.35)" />
        </svg>
      </div>
    `,
  });
}

function safetyTeamIcon(L: any, text: string) {
  return locationPinIcon(L, text, "#B22222", "#7f1414", "#ffffff");
}

function safetyMarkerText(marker: TopoMapMarker) {
  const supplied = String(marker.markerText || "").trim();

  // v0.06.53 originally fell back to "S". If that happens, derive the
  // letter from the Safety Team name instead: Safety Team Alpha -> A.
  if (supplied && supplied.toUpperCase() !== "S") {
    return supplied.toUpperCase();
  }

  const safetyName = marker.label
    .replace(/^Safety Team\s*/i, "")
    .trim();

  return (safetyName.charAt(0) || "S").toUpperCase();
}

function drawMarkers(L: any, layer: any, markers: TopoMapMarker[]) {
  layer.clearLayers();

  markers.forEach((marker) => {
    const icon =
      marker.kind === "station"
        ? stationPinIcon(L)
        : marker.kind === "safety"
        ? safetyTeamIcon(L, safetyMarkerText(marker))
        : marker.kind === "team"
        ? teamPinIcon(L, marker.markerText || "")
        : currentArrowIcon(L);

    const mapMarker = L.marker(
      [marker.latitude, marker.longitude],
      { icon, keyboard: true }
    );

    mapMarker.bindTooltip(
      `<strong>${marker.label}</strong>${
        marker.detail
          ? `<br/><span style="font-weight:600;color:#475569">${marker.detail}</span>`
          : ""
      }`,
      marker.kind === "station"
        ? {
            permanent: true,
            direction: "top",
            offset: [0, -4],
            className: "station-label",
          }
        : {
            direction: "top",
            offset: [0, -4],
          }
    );

    mapMarker.addTo(layer);
  });
}

export default function TopoEventMap({
  markers,
  center = null,
  zoom = 15,
  heightClass = "h-[460px] md:h-[620px]",
  onMapClick,
  rasterBackground = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);
  const clickHandlerRef = useRef(onMapClick);

  clickHandlerRef.current = onMapClick;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!containerRef.current) return;

      installStyle();
      const L = await loadLeaflet();

      if (cancelled || !containerRef.current) return;

      const start = center || { latitude: 1.3521, longitude: 103.8198 };
      const map = L.map(containerRef.current, { zoomControl: true }).setView(
        [start.latitude, start.longitude],
        zoom
      );

      if (rasterBackground) {
        const bounds = [
          [
            rasterBackground.southWest.latitude,
            rasterBackground.southWest.longitude,
          ],
          [
            rasterBackground.northEast.latitude,
            rasterBackground.northEast.longitude,
          ],
        ];

        L.imageOverlay(rasterBackground.imageUrl, bounds, {
          opacity: 1,
          interactive: false,
        }).addTo(map);

        map.fitBounds(bounds, { padding: [10, 10] });
      } else {
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap contributors",
        }).addTo(map);
      }

      const Key = L.Control.extend({
        options: { position: "bottomleft" },
        onAdd() {
          const el = L.DomUtil.create("div", "event-map-key");
          const rows = [
            "<strong>Map Key</strong>",
            "Cream numbered pin: Team GPS",
            "Red lettered pin: Safety Team GPS",
            "Purple pin: Game location",
            "Green arrow: Your current GPS",
          ];
          el.innerHTML = rows.join("<br/>");
          return el;
        },
      });

      new Key().addTo(map);

      const North = L.Control.extend({
        options: { position: "topright" },
        onAdd() {
          const el = L.DomUtil.create("div", "event-map-north");
          el.innerHTML = '<div style="font-size:24px;line-height:22px">↑</div>N';
          return el;
        },
      });

      new North().addTo(map);

      markerLayerRef.current = L.layerGroup().addTo(map);
      map.on("click", (event: any) => {
        clickHandlerRef.current?.(event.latlng.lat, event.latlng.lng);
      });

      mapRef.current = map;
      drawMarkers(L, markerLayerRef.current, markers);

      window.setTimeout(() => map.invalidateSize(), 100);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (window.L && markerLayerRef.current) {
      drawMarkers(window.L, markerLayerRef.current, markers);
    }
  }, [markers]);

  useEffect(() => {
    if (center && mapRef.current && !rasterBackground) {
      mapRef.current.setView([center.latitude, center.longitude], zoom);
    }
  }, [center?.latitude, center?.longitude, zoom, rasterBackground]);

  return (
    <div
      ref={containerRef}
      className={`event-command-live-map w-full ${heightClass}`}
      aria-label="Event map"
    />
  );
}
