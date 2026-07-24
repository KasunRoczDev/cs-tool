import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

/**
 * Pushes live metrics / security events / alerts to dashboard clients.
 * Clients join a per-server room ("server:<id>") or "all".
 */
@WebSocketGateway({
  cors: { origin: process.env.DASHBOARD_ORIGIN?.split(',') ?? '*' },
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly log = new Logger('Realtime');

  handleConnection(client: Socket) {
    client.join('all');
    this.log.debug(`client ${client.id} connected`);
  }

  @SubscribeMessage('subscribe')
  onSubscribe(
    @MessageBody() serverId: string,
    @ConnectedSocket() client: Socket,
  ) {
    if (serverId) client.join(`server:${serverId}`);
    return { ok: true };
  }

  emitMetric(serverId: string, metric: unknown) {
    this.server.to('all').to(`server:${serverId}`).emit('metric', metric);
  }

  emitSecurityEvent(serverId: string, event: unknown) {
    this.server.to('all').to(`server:${serverId}`).emit('security_event', event);
  }

  emitAlert(alert: unknown) {
    this.server.to('all').emit('alert', alert);
  }

  emitServerStatus(payload: unknown) {
    this.server.to('all').emit('server_status', payload);
  }

  /**
   * Release-management realtime channel. The dashboard listens for
   * 'release_event' to live-update the releases list and the deployment
   * pipeline board. `type` is e.g. release.promoted / deployment.succeeded.
   */
  emitReleaseEvent(type: string, payload: unknown) {
    this.server.to('all').emit('release_event', { type, payload });
  }
}
