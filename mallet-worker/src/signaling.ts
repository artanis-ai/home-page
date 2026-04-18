/**
 * Durable Object that acts as a y-webrtc signaling server.
 * Each room gets its own DO instance. Clients connect via WebSocket,
 * subscribe to topics, and the DO relays messages between peers.
 *
 * Auth: signaling is INTENTIONALLY UNAUTHENTICATED so that anyone
 * with a room URL — including anonymous (signed-out, incognito)
 * users — can join the collaborative session. Rooms are scoped by
 * the URL the user pasted: /d/<uuid> uses a random UUID (link-auth
 * by obscurity), /gh/<owner>/<repo>/<branch>/<path> uses public-repo
 * metadata that's already public. The expensive authenticated work
 * (/api/analyze, /api/suggest, /api/create-pr) stays gated behind
 * Clerk — signaling only shuffles small WebRTC offer/answer blobs.
 *
 * Previously we required a Clerk JWT in ?token=, but that locked
 * signed-out users out of their own scratch pads and made incognito
 * collaboration impossible (no shared Clerk session across browser
 * profiles).
 *
 * Hibernation: we use `state.acceptWebSocket()` so the DO can evict
 * from memory between messages without closing live WebSockets.
 * Per-connection topic subscriptions MUST therefore live on the
 * WebSocket attachment (durable across hibernation), NOT in an
 * in-memory Map — a prior implementation stored them in a Map which
 * was reset to `new Map()` on every wake, silently dropping all
 * subsequent subscribe/publish messages and breaking cross-tab /
 * cross-browser collaboration.
 */
import type { Env } from './types'

interface Attachment {
  topics: string[]
}

function readTopics(ws: WebSocket): Set<string> {
  const a = (ws as unknown as { deserializeAttachment: () => Attachment | null }).deserializeAttachment()
  return new Set(a?.topics ?? [])
}

function writeTopics(ws: WebSocket, topics: Set<string>): void {
  ;(ws as unknown as { serializeAttachment: (v: Attachment) => void }).serializeAttachment({
    topics: Array.from(topics),
  })
}

export class SignalingRoom implements DurableObject {
  constructor(private state: DurableObjectState, _env: Env) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    // No auth check — see module comment. Anyone with the room URL joins.
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]

    this.state.acceptWebSocket(server)
    writeTopics(server as unknown as WebSocket, new Set())

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return

    let msg: { type: string; topics?: string[]; topic?: string; [key: string]: unknown }
    try {
      msg = JSON.parse(message)
    } catch {
      return
    }

    if (msg.type === 'subscribe') {
      const current = readTopics(ws)
      for (const t of msg.topics || []) current.add(t)
      writeTopics(ws, current)
    } else if (msg.type === 'unsubscribe') {
      const current = readTopics(ws)
      for (const t of msg.topics || []) current.delete(t)
      writeTopics(ws, current)
    } else if (msg.type === 'publish') {
      const topic = msg.topic
      if (!topic) return
      // Relay to every other socket subscribed to this topic. Using
      // state.getWebSockets() rather than an in-memory registry is the
      // point of the hibernation-safe design.
      for (const conn of this.state.getWebSockets()) {
        if (conn === ws) continue
        if (readTopics(conn).has(topic)) {
          try {
            conn.send(message)
          } catch {
            // Socket in a bad state — drop silently; getWebSockets()
            // will stop returning it once it's closed.
          }
        }
      }
    } else if (msg.type === 'ping') {
      try {
        ws.send(JSON.stringify({ type: 'pong' }))
      } catch {
        // ignore
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    // No in-memory registry to clean; attachment is discarded with the socket.
    void ws
  }

  async webSocketError(ws: WebSocket) {
    void ws
  }
}
