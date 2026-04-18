/**
 * Durable Object that acts as a y-webrtc signaling server.
 * Each room gets its own DO instance. Clients connect via WebSocket,
 * subscribe to topics, and the DO relays messages between peers.
 *
 * Auth: WebSocket connections require a Clerk session token in the
 * `?token=` query parameter (custom headers can't be set during the
 * browser WebSocket handshake). The token is verified against Clerk's
 * JWKS before accepting the connection.
 */
import { verifyClerkJWT } from './lib/auth'
import type { Env } from './types'

export class SignalingRoom implements DurableObject {
  private connections: Map<WebSocket, Set<string>> = new Map()

  constructor(
    private state: DurableObjectState,
    private env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    // Verify Clerk session token from query string.
    const url = new URL(request.url)
    const token = url.searchParams.get('token')
    if (!token) {
      return new Response('Unauthorized: missing token', { status: 401 })
    }

    try {
      await verifyClerkJWT(this.env, token)
    } catch {
      return new Response('Unauthorized: invalid token', { status: 401 })
    }

    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]

    this.state.acceptWebSocket(server)
    this.connections.set(server, new Set())

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

    const subscribedTopics = this.connections.get(ws)
    if (!subscribedTopics) return

    if (msg.type === 'subscribe') {
      const topics = msg.topics || []
      for (const topic of topics) {
        subscribedTopics.add(topic)
      }
    } else if (msg.type === 'unsubscribe') {
      const topics = msg.topics || []
      for (const topic of topics) {
        subscribedTopics.delete(topic)
      }
    } else if (msg.type === 'publish') {
      const topic = msg.topic
      if (!topic) return

      for (const [conn, topics] of this.connections) {
        if (conn !== ws && topics.has(topic)) {
          try {
            conn.send(message)
          } catch {
            this.connections.delete(conn)
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
    this.connections.delete(ws)
  }

  async webSocketError(ws: WebSocket) {
    this.connections.delete(ws)
  }
}
