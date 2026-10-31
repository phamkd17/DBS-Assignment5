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
    // Standard OpenStreetMap tiles (no key), drawn in grayscale by .station-map
    // in globals.css so only our station dots are in color.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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
        // On the gray map: white dots for every station, blue for ones I follow.
        radius: isSelected ? 9 : isFollowed ? 7 : 5,
        color: isSelected ? "#082f49" : isFollowed ? "#075985" : "#334155",
        weight: isSelected ? 3 : 1.5,
        fillColor: isFollowed ? "#0284c7" : isSelected ? "#7dd3fc" : "#ffffff",
        fillOpacity: 1,
      })
        .bindTooltip(s.name)
        .on("click", () => onSelectRef.current(s.station_id))
        .addTo(layer);
    }
    return () => {
      layer.remove();
    };
  }, [stations, followed, selectedId]);

  return (
    <div
      ref={el}
      className="station-map h-80 w-full rounded-lg border border-slate-200 sm:h-96"
      role="application"
      aria-label="Map of Divvy stations"
    />
  );
}
