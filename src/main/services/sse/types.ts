/* Payloads carried by realtime WebSocket envelopes. Field names are part of
   the server contract and must stay camelCase, byte-for-byte. */

export interface Notification {
  invalidate: "notifications";
}
