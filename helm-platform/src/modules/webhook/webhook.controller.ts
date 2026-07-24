import { Body, Controller, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ProviderRegistry } from '../git-provider/provider-registry';
import { EventBus } from '../../common/events/event-bus.port';

/** Verifies provider signatures and drops normalized events on the bus (blueprint C.1 helm-webhooks). */
@Controller('api/v1/webhooks')
export class WebhookController {
  constructor(private readonly providers: ProviderRegistry, private readonly bus: EventBus) {}

  @Post(':provider')
  @HttpCode(202)
  async ingest(@Param('provider') providerKey: string, @Headers() headers: any, @Req() req: any, @Body() body: any) {
    const provider = this.providers.for(providerKey);
    const raw: Buffer = req.rawBody ?? Buffer.from(JSON.stringify(body));
    if (!provider.verifyWebhook(headers, raw)) return { accepted: false, reason: 'invalid_signature' };
    const events = provider.normalizeWebhook(headers, body);
    for (const e of events) await this.bus.publish(e);
    return { accepted: true, events: events.length };
  }
}
