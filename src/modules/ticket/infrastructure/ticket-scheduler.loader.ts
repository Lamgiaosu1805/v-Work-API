import { SchedulerLoader, TicketScheduler } from "../application/ticket-scheduling";
import { loadTicketCalendar, loadTicketSettings } from "./ticket-settings";

export class MongooseSchedulerLoader implements SchedulerLoader {
  // eslint-disable-next-line class-methods-use-this
  async load(now: Date): Promise<TicketScheduler> {
    const settings = await loadTicketSettings();
    const calendar = await loadTicketCalendar(settings, now);
    return { policy: settings.policy, calendar, settings };
  }
}
