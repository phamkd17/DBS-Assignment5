# Data source: Divvy (Chicago bike share)

Divvy publishes a public [GBFS](https://gbfs.org) feed. No API key.

- Station info: `https://gbfs.lyft.com/gbfs/2.3/chi/en/station_information.json` (~680 KB, rarely changes)
- Station status: `https://gbfs.lyft.com/gbfs/2.3/chi/en/station_status.json` (~880 KB, `ttl: 60`)

Both list ~2,078 stations, joined on `station_id`.

## What changes, and how fast

Two status snapshots taken 4 minutes apart (Oct 31, 2026, ~4:25 PM CT):

| | stations |
|---|---|
| in both snapshots | 2,078 (none added or removed) |
| `last_reported` changed | 1,149 |
| bikes / e-bikes / docks / renting changed | **166** |

`last_reported` ticks whenever a station checks in, even if nothing changed.
The worker therefore detects changes by comparing the fields people care
about, not timestamps. Otherwise it would rewrite ~7x more rows, and each
rewrite is a Realtime message to every open page.

## Fields

### `station_information`
| field | meaning | used |
|---|---|---|
| `station_id` | stable ID | primary key |
| `name` | "Wells St & Ohio St" | yes |
| `lat`, `lon` | location | yes |
| `capacity` | total docks | yes |
| `short_name`, `rental_uris`, `is_charging` | internal code, app links | no |

### `station_status`
| field | meaning | used |
|---|---|---|
| `num_bikes_available` | rideable bikes, classic + e-bike | yes |
| `num_ebikes_available` | e-bike subset | yes |
| `num_docks_available` | open docks to return a bike | yes |
| `is_installed`, `is_renting`, `is_returning` | station in service | yes |
| `last_reported` | last station check-in (unix s) | stored, not compared |
| `num_*_disabled`, `vehicle_types_available`, `num_scooters_*` | broken bikes, per-type counts, scooters | no |
| top-level `last_updated` | when Lyft generated the feed | yes, freshness |

Classic bikes = `num_bikes_available - num_ebikes_available`.
