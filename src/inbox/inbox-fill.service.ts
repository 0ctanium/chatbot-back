import { Injectable } from '@nestjs/common';
import { InjectRepository } from "@nestjs/typeorm";
import { MoreThan, Repository } from "typeorm";
import { Events } from "@core/entities/events.entity";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Inbox } from "@core/entities/inbox.entity";
import { EventActionTypeEnum } from "@core/enums/event-action-type.enum";
import { Intent } from "@core/entities/intent.entity";
import { InboxStatus } from "@core/enums/inbox-status.enum";

@Injectable()
export class InboxFillService {
  constructor(@InjectRepository(Events)
              private readonly _eventsRepository: Repository<Events>,
              @InjectRepository(Inbox)
              private readonly _inboxesRepository: Repository<Inbox>) {
  }

  // Check last events of the chatbot to fill Inbox
  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkEvents() {
    // Get max timestamp of inbox
    const maxTimestamp = (await this._inboxesRepository
      .createQueryBuilder()
      .select('MAX(timestamp)', 'timestamp')
      .getRawOne())?.timestamp;

    // Find all events which occurs after this timestamp
    const events: Events[] = await this._eventsRepository.find({
      where: {
        timestamp: MoreThan(maxTimestamp ? maxTimestamp : 0)
      },
      order: {
        timestamp: 'ASC'
      }
    });

    if (events.length < 1) {
      return;
    }


    const inboxes: Inbox[] = [];
    while (events.length > 0) {
      const conversationIdx = events.findIndex(e => e.action_name === EventActionTypeEnum.action_listen);
      const eventsSlice = events.slice(0, conversationIdx + 1);
      if(this._canGenerateInbox(eventsSlice)) {
        inboxes.push(this._getNextInbox(eventsSlice));
      }
      events.splice(0, conversationIdx + 1);
    }
    this._inboxesRepository.save(inboxes);
  }

  private _getNextInbox(events: Events[]): Inbox {
    const inbox = new Inbox();
    inbox.timestamp = Math.max.apply(Math, events.map(e => e.timestamp));

    inbox.sender_id = events[0]?.sender_id;
    inbox.event_id = events[0]?.id;
    inbox.response = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      // @ts-ignore
      const data = JSON.parse(event?.data);

      switch (data?.event) {
        case 'action':
          break;
        case 'bot':
          inbox.response.push({text: data.text, data: data.data});
          break;
        case 'user':
          inbox.question = data.text;
          inbox.confidence = data.parse_data?.intent?.confidence;
          inbox.status = (inbox.confidence > 0.7) ? InboxStatus.to_verify : InboxStatus.pending
          inbox.intent = new Intent(data.parse_data?.intent?.name);
          break;
      }
    }
    inbox.response = JSON.stringify(inbox.response);
    return inbox;
  }

  private _canGenerateInbox(events: Events[]): boolean {
    return events.findIndex(e => {
      return e.type_name === 'user' || e.type_name === 'bot';
    }) >= 0;
  }
}
