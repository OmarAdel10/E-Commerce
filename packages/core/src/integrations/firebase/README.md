# Firebase (FCM push)

Firebase Cloud Messaging is the legacy staff push path. The dashboard now enrolls browsers through first-party Web Push (`packages/core/src/integrations/web-push/`, `apps/admin-v2/src/lib/web-push.ts`). The FCM server code remains for staff devices that registered a token earlier. The server calls the FCM HTTP v1 REST API directly with Web Crypto. It does not use the Node.js `firebase-admin` SDK. This document is for contributors and operators. Which events push, and how receipts and pauses work, is in the [notifications README](../../modules/notifications/README.md).

## Flow

Current enrollment is Web Push, not Firebase:

1. A staff member turns on "Notifications on this device" in My account (`ThisDeviceNotifications.tsx`). The dashboard reads the VAPID public key from `GET /api/v1/admin/web-push`, subscribes the browser through `apps/admin-v2/public/web-push-sw.js` and saves the subscription at `POST /api/v1/admin/web-push/subscriptions`. The platform derives the VAPID keys from `SCALIUS_SECRET`; there is no service account to save.
2. For each staff push the API sends to the Web Push browsers and to the active FCM tokens alike (`sendAdminPush()` in the notifications domain).

The FCM part of that send still works as follows:

1. A service account and web app config saved to the `firebase` settings document (`POST /api/v1/admin/settings/firebase`) enable the FCM sender. The dashboard no longer offers a screen or hook for this (`useFirebaseInit` is gone).
2. Tokens already in `admin_fcm_tokens` (registered by `POST /api/v1/admin/fcm-token`) receive one FCM request each (`sendOrderNotification()` and the other senders in the notifications domain).
3. `apps/admin-v2/public/firebase-messaging-sw.js` is a retirement worker. It has install and activate handlers only and unregisters itself, so a browser that held the old Firebase worker drops its subscription and never shows a notification twice.

## Credentials

The `firebase` settings document (`firebaseDocument` in `packages/core/src/modules/settings/documents.ts`):

| Field | Meaning |
|---|---|
| `serviceAccount` | Service account JSON. A secret, encrypted at rest with `CREDENTIAL_ENCRYPTION_KEY`. |
| `publicConfig` | Web app config (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, `vapidKey`, optional `measurementId`). Not secret. |

- The dashboard is the only source of the service account. There is no environment variable.
- A service account must have non-empty `client_email`, `private_key` and `project_id`. `normalizeFirebaseServiceAccountJson()` rejects anything else.
- `readFirebaseServiceAccountJson()` returns `undefined` for a missing or unusable account. It never throws. Never call FCM with unreadable ciphertext, and never fall back to a JWT secret.
- `getFirebaseServiceAccountReadiness()` returns `missing_firebase_service_account` or `unusable_firebase_service_account`. The notification settings use it before they allow push.

## Server client (`admin.ts`)

- `getFirebaseAdminMessaging(env, serviceAccountJson)` builds a new `FCMMessagingService` per call. It throws `ServiceUnavailableError` when the JSON is empty.
- Auth: an RS256 JWT with scope `https://www.googleapis.com/auth/firebase.messaging`, exchanged at `https://oauth2.googleapis.com/token`.
- Token cache: memory per instance (3300 s). Nothing is persisted; a cold instance exchanges the JWT again.
- Send: `sendEachForMulticast()` makes one request per token to `https://fcm.googleapis.com/v1/projects/<project_id>/messages:send`. `FCM_SEND_CONCURRENCY` is a fixed 8.
- Retry: up to 3 attempts for HTTP 429 and 5xx. Backoff is `2^attempt` seconds plus up to 1 s of jitter. `Retry-After` overrides it.
- `admin.ts` maps the FCM status to a `messaging/*` error code (for example `UNREGISTERED` -> `messaging/registration-token-not-registered`). Anything unknown becomes `messaging/unknown-error`.

## Routes

| Method and path | Auth |
|---|---|
| `GET /api/v1/auth/firebase-config` (`publicConfig` only) | public |
| `GET /api/v1/admin/settings/firebase` (masked service account, `publicConfig`, `revision`) | `settings.notifications.edit` |
| `POST /api/v1/admin/settings/firebase` (saves both with `expectedRevision`) | `settings.notifications.edit` |
| `POST /api/v1/admin/fcm-token` (registers a token) | any admin session |
| `POST /api/v1/admin/fcm-token-cleanup` (deactivates tokens) | `settings.notifications.edit` |

- A stale `expectedRevision` returns 409.
- A masked service account value is ignored. An empty value clears it. A new value needs `CREDENTIAL_ENCRYPTION_KEY` (503 without it).
- A service account change clears the `push` provider pause markers in the same batch.
- `fcm-token` needs `userId` equal to the session user (403 otherwise). It upserts on the unique `token` and sets `is_active` to true.
- `fcm-token-cleanup` takes 1 to 10 `invalidTokens` and deactivates them. It also deactivates tokens whose `last_used` is empty or older than 30 days.

## Database

Table `admin_fcm_tokens` (`packages/database/src/schema/system.ts`): `user_id`, unique `token`, `device_info` (JSON text), `is_active`, `last_used`.

## Limits

- The dashboard loads no Firebase SDK. The retired `firebase-messaging-sw.js` imports none; the live worker is `web-push-sw.js`.
- Staff push is Web Push plus retained FCM. Web Push is first-party (VAPID keys from `SCALIUS_SECRET`, RFC 8291 encryption); FCM needs a Google service account and is delivered separately.
