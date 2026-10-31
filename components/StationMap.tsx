"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Station } from "@/lib/types";

// Every Divvy station as a dot. Followed stations are bigger and blue; click a
// dot to select it. Leaflet only runs in the browser, so this file is loaded
// with next/dynamic and ssr: false.
export default function StationMap(props: {
  stations: Station[];
  followed: Set<string>;
  selectedId: string | null;
  center: { lat: number; lon: number };
  onSelect: (id: string) => void;
}) {
  const { stations, followed, selectedId, center, onSelect } = props;
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { preferCanvas: true, zoomControl: true }).setView([center.lat, center.lon], 14);
    // A quiet light basemap (no bus-stop icons), so the station dots stand out.
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: "abcd",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // Created once; center changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.setView([center.lat, center.lon], map.current.getZoom());
  }, [center.lat, center.lon]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const layer = L.layerGroup().addTo(m);
    for (const s of stations) {
      const isFollowed = followed.has(s.station_id);
      const isSelected = s.station_id === selectedId;
      L.circleMarker([s.lat, s.lon], {
        radius: isSelected ? 9 : isFollowed ? 7 : 5,
        color: isSelected ? "#0c4a6e" : isFollowed ? "#0369a1" : "#64748b",
        weight: isSelected ? 3 : 1,
        fillColor: isFollowed || isSelected ? "#0ea5e9" : "#cbd5e1",
        fillOpacity: 0.9,
      })
        .bindTooltip(s.name)
        .on("click", () => onSelectRef.current(s.station_id))
        .addTo(layer);
    }
    return () => {
      layer.remove();
    };
  }, [stations, followed, selectedId]);

  return <div ref={el} className="h-80 w-full rounded-lg border border-slate-200 sm:h-96" role="application" aria-label="Map of Divvy stations" />;
}
