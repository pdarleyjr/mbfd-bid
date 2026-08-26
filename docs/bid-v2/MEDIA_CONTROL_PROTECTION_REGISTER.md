# MBFD Bid v2 Media Control protection register

## Rule

Every resource in this register is `DO_NOT_TOUCH = TRUE` for Bid work unless the user separately authorizes an actual Media Control change. If a resource is shared or uncertain, treat it as protected.

| Resource class | Sanitized identifier | DO_NOT_TOUCH | Observed state |
| --- | --- | --- | --- |
| Compose project | `media-control` | TRUE | Running on the shared GMKtec host. |
| Container | `media-control` | TRUE | Running and health check `healthy`. |
| Application endpoint | Existing local version endpoint | TRUE | HTTP 200 during passive baseline. |
| Checkout/release paths | Media Control source and release paths | TRUE | Present on shared host; exact paths intentionally omitted. |
| Host bindings/networking | Media Control private host bindings | TRUE | Active; values intentionally omitted. |
| Cloudflared/tunnel resources | Existing cloudflared services and unknown/shared account resources | TRUE | Multiple active services/resources require ownership proof. |
| Related streaming/display services | Any media, camera, player, OBS/RTMP, MediaMTX, or monitoring asset | TRUE | Treat as Media Control-associated until independently disproven. |

## Baseline evidence

- Passive precheck: container `healthy`; running `true`; version endpoint HTTP 200.
- No server, Docker, Cloudflare, tunnel, DNS, port, firewall, GPU, or runtime modification occurred in this workstream.
- A postcheck is not applicable until a potentially shared infrastructure change is proposed. It then becomes mandatory.

## Bid design response

Bid work remains local/Cloudflare-only until an isolated resource design is proven. Any future server-side Bid service must use a unique Compose project, network, volumes, limits, health check, and private binding, without a Docker socket or shared service restart.
