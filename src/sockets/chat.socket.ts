import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { Pool } from "pg";

export interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: "parent" | "supervisor" | "admin";
  barcode?: string;
}

export interface ChatSocketConfig {
  redisUrl?: string;
  corsOrigins?: string[];
  notificationDispatcher?: (targetUserId: string, title: string, body: string, conversationId: string) => Promise<void>;
}

export class ChatSocketServer {
  private io: SocketIOServer;
  private pubClient: Redis;
  private subClient: Redis;
  private pgPool: Pool;
  private notificationDispatcher?: (targetUserId: string, title: string, body: string, conversationId: string) => Promise<void>;

  constructor(
    httpServer: HttpServer,
    pgPool: Pool,
    redisClient: Redis,
    config?: ChatSocketConfig
  ) {
    this.pgPool = pgPool;
    this.notificationDispatcher = config?.notificationDispatcher;

    // Create dedicated Pub/Sub clients for Socket.io Redis Adapter
    this.pubClient = redisClient.duplicate();
    this.subClient = redisClient.duplicate();

    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: config?.corsOrigins || "*",
        methods: ["GET", "POST"],
        credentials: true,
      },
      transports: ["websocket", "polling"],
      pingInterval: 25000,
      pingTimeout: 20000,
    });

    // Mount Redis Adapter for horizontal multi-node cluster scaling
    this.io.adapter(createAdapter(this.pubClient, this.subClient));

    this.setupAuthMiddleware();
    this.setupEventHandlers();
    this.setupClusterRevocationSubscriber();
  }

  public getIO(): SocketIOServer {
    return this.io;
  }

  /**
   * Handshake Authentication Middleware
   */
  private setupAuthMiddleware(): void {
    this.io.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
        const barcode = socket.handshake.auth?.barcode || socket.handshake.query?.barcode;
        const role = socket.handshake.auth?.role || "parent";

        if (!barcode) {
          return next(new Error("Authentication failed: Barcode is required"));
        }

        const cleanBarcode = String(barcode).trim();

        // Check if account has been suspended/revoked in Redis
        const isRevoked = await this.pubClient.get(`auth:revoked:${cleanBarcode}`);
        if (isRevoked) {
          return next(new Error("Access denied: Account session is suspended or revoked"));
        }

        socket.userId = cleanBarcode;
        socket.barcode = cleanBarcode;
        socket.userRole = role;

        return next();
      } catch (err: any) {
        return next(new Error(`Authentication internal error: ${err.message}`));
      }
    });
  }

  /**
   * Main Socket Event Handlers
   */
  private setupEventHandlers(): void {
    this.io.on("connection", async (socket: AuthenticatedSocket) => {
      const userId = socket.userId!;
      const barcode = socket.barcode!;
      const role = socket.userRole || "parent";

      console.info(`[ChatSocket] Socket connected: ${socket.id} (User: ${userId}, Role: ${role})`);

      // Join user's personal notification room
      socket.join(`user:${userId}`);

      // 1. Mark Presence Online in Redis Set
      await this.pubClient.sadd("presence:online_users", userId);
      this.io.emit("presence:status_changed", { userId, isOnline: true });

      // Join specific conversation room
      socket.on("join_conversation", async ({ conversationId }: { conversationId: string }) => {
        if (!conversationId) return;
        const roomName = `conv:${conversationId}`;
        socket.join(roomName);
        console.info(`[ChatSocket] User ${userId} joined room ${roomName}`);
      });

      // Leave conversation room
      socket.on("leave_conversation", ({ conversationId }: { conversationId: string }) => {
        if (!conversationId) return;
        socket.leave(`conv:${conversationId}`);
      });

      // Send Real-Time Chat Message
      socket.on("send_message", async (data: {
        conversationId: string;
        text: string;
        recipientId?: string;
      }, ack?: (response: any) => void) => {
        try {
          const { conversationId, text, recipientId } = data;
          if (!conversationId || !text || !text.trim()) {
            if (ack) ack({ error: "Missing conversationId or text" });
            return;
          }

          const cleanText = text.trim();

          // 1. Ensure conversation exists in DB
          let convUuid: string;
          const convCheck = await this.pgPool.query(
            `SELECT id FROM chat_conversations WHERE student_barcode = $1`,
            [conversationId]
          );

          if (convCheck.rows.length === 0) {
            const newConv = await this.pgPool.query(
              `INSERT INTO chat_conversations (student_barcode, title, last_message_text, last_message_at)
               VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
               RETURNING id`,
              [conversationId, `محادثة الطالب ${conversationId}`, cleanText]
            );
            convUuid = newConv.rows[0].id;
          } else {
            convUuid = convCheck.rows[0].id;
            await this.pgPool.query(
              `UPDATE chat_conversations 
               SET last_message_text = $1, last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
               WHERE id = $2`,
              [cleanText, convUuid]
            );
          }

          // 2. Persist Message in chat_messages table
          const msgInsert = await this.pgPool.query(
            `INSERT INTO chat_messages (conversation_id, sender_id, sender_role, text, status)
             VALUES ($1, $2, $3, $4, 'SENT')
             RETURNING id, conversation_id, sender_id, sender_role, text, status, created_at`,
            [convUuid, userId, role, cleanText]
          );

          const savedMessage = msgInsert.rows[0];

          // 3. Broadcast to Conversation Room across cluster
          this.io.to(`conv:${conversationId}`).emit("new_message", {
            ...savedMessage,
            conversationId,
            timeFormatted: new Intl.DateTimeFormat("ar-EG", {
              hour: "numeric",
              minute: "numeric",
              hour12: true,
            }).format(new Date(savedMessage.created_at)),
          });

          // 4. Dispatch Push Notification to Recipient
          if (this.notificationDispatcher) {
            const target = recipientId || (role === "supervisor" ? conversationId : "admin");
            const title = role === "supervisor" ? "رسالة جديدة من إدارة المنظومة" : `رسالة جديدة من ولي أمر (${conversationId})`;
            this.notificationDispatcher(target, title, cleanText, conversationId).catch((e) =>
              console.warn("[ChatSocket] Push Dispatch error:", e.message)
            );
          }

          if (ack) ack({ success: true, message: savedMessage });
        } catch (err: any) {
          console.error("[ChatSocket] send_message error:", err);
          if (ack) ack({ error: "Failed to send message", details: err.message });
        }
      });

      // In-Memory Typing Indicator (0 DB Hit)
      socket.on("typing", ({ conversationId, isTyping }: { conversationId: string; isTyping: boolean }) => {
        if (!conversationId) return;
        socket.to(`conv:${conversationId}`).emit("user_typing", {
          conversationId,
          userId,
          isTyping: !!isTyping,
        });
      });

      // Read Receipts Handling
      socket.on("mark_read", async ({ conversationId, messageIds }: { conversationId: string; messageIds: string[] }) => {
        if (!conversationId || !Array.isArray(messageIds) || messageIds.length === 0) return;

        try {
          await this.pgPool.query(
            `UPDATE chat_messages 
             SET status = 'READ', read_at = CURRENT_TIMESTAMP 
             WHERE id = ANY($1::uuid[]) AND status != 'READ'`,
            [messageIds]
          );

          this.io.to(`conv:${conversationId}`).emit("messages_read", {
            conversationId,
            messageIds,
            readBy: userId,
            readAt: new Date().toISOString(),
          });
        } catch (err: any) {
          console.error("[ChatSocket] mark_read error:", err);
        }
      });

      // Cursor-Based Fast Message Pagination
      socket.on("fetch_history", async (data: {
        conversationId: string;
        cursor?: string; // ISO Timestamp or timestamp ms of the oldest message currently displayed
        limit?: number;
      }, ack: (response: any) => void) => {
        try {
          const { conversationId, cursor } = data;
          const limit = Math.min(data.limit || 30, 100);

          if (!conversationId) {
            ack({ error: "Missing conversationId" });
            return;
          }

          let query: string;
          let params: any[];

          if (cursor) {
            query = `
              SELECT m.id, m.sender_id, m.sender_role, m.text, m.status, m.created_at
              FROM chat_messages m
              JOIN chat_conversations c ON c.id = m.conversation_id
              WHERE c.student_barcode = $1 AND m.created_at < $2
              ORDER BY m.created_at DESC
              LIMIT $3;
            `;
            params = [conversationId, new Date(cursor), limit];
          } else {
            query = `
              SELECT m.id, m.sender_id, m.sender_role, m.text, m.status, m.created_at
              FROM chat_messages m
              JOIN chat_conversations c ON c.id = m.conversation_id
              WHERE c.student_barcode = $1
              ORDER BY m.created_at DESC
              LIMIT $2;
            `;
            params = [conversationId, limit];
          }

          const { rows } = await this.pgPool.query(query, params);

          // Return in chronological order
          const messages = rows.reverse().map((r) => ({
            ...r,
            conversationId,
            timeFormatted: new Intl.DateTimeFormat("ar-EG", {
              hour: "numeric",
              minute: "numeric",
              hour12: true,
            }).format(new Date(r.created_at)),
          }));

          const nextCursor = rows.length > 0 ? rows[0].created_at : null;
          const hasMore = rows.length === limit;

          ack({
            success: true,
            conversationId,
            messages,
            nextCursor,
            hasMore,
          });
        } catch (err: any) {
          console.error("[ChatSocket] fetch_history error:", err);
          ack({ error: "Failed to fetch history", details: err.message });
        }
      });

      // Disconnect Lifecycle
      socket.on("disconnect", async () => {
        console.info(`[ChatSocket] Socket disconnected: ${socket.id} (User: ${userId})`);
        await this.pubClient.srem("presence:online_users", userId);
        this.io.emit("presence:status_changed", { userId, isOnline: false });
      });
    });
  }

  /**
   * Subscribes to Redis Pub/Sub for immediate cluster-wide forced disconnects on account revocation
   */
  private setupClusterRevocationSubscriber(): void {
    const subscriber = this.subClient.duplicate();
    subscriber.subscribe("auth:force_disconnect", (err) => {
      if (err) console.error("[ChatSocket] Failed to subscribe to auth:force_disconnect:", err);
    });

    subscriber.on("message", (channel, message) => {
      if (channel === "auth:force_disconnect") {
        try {
          const { barcode, reason } = JSON.parse(message);
          if (!barcode) return;

          // Find all local sockets matching this barcode and forcibly disconnect them
          this.io.in(`user:${barcode}`).emit("account_revoked", {
            barcode,
            reason,
            timestamp: Date.now(),
          });

          this.io.in(`user:${barcode}`).disconnectSockets(true);
          console.info(`[ChatSocket] Forcibly disconnected sockets for revoked user ${barcode}`);
        } catch (e: any) {
          console.warn("[ChatSocket] Error processing force_disconnect message:", e.message);
        }
      }
    });
  }
}
