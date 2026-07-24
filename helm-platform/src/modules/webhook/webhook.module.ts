import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { GitProviderModule } from '../git-provider/git-provider.module';
import { EventsModule } from '../../common/events/events.module';

@Module({ imports: [GitProviderModule, EventsModule], controllers: [WebhookController] })
export class WebhookModule {}
