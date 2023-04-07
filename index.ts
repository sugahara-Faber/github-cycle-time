import math from 'mathjs';
import moment from 'moment';
import defaults from 'defaults';
import store from 'abstract-blob-store';
import momentDurationSetup from 'moment-duration-format';
import { Octokit } from '@octokit/rest';
import { PaginateInterface } from '@octokit/plugin-paginate-rest';
import { RestEndpointMethods } from '@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types';
import { Api } from '@octokit/plugin-rest-endpoint-methods/dist-types/types';

momentDurationSetup(moment);

const getIssues = async (client: Octokit & { paginate: PaginateInterface; } & RestEndpointMethods & Api, opts:
  { org: string; filter?: "all" | "assigned" | "created" | "mentioned" | "subscribed" | "repos"; state?: "all" | "open" | "closed"; direction?: "asc" | "desc"; per_page: number; page: number; since: string; }) => {
  return await client.paginate(client.issues.list, opts)
}

type Issue = Awaited<ReturnType<typeof getIssues>>;

type Options = {
  baseUrl: string;
  cache: store;
  org: string;
  token: string;
}

export class CycleTime {
  Client: Octokit;
  options: Options;

  constructor(options = {}) {
    this.options = defaults(options, {
      baseUrl: 'https://api.github.com',
      cache: new store(),
      org: null,
      token: null
    });

    if (this.options.org === null) {
      new Error('Missing Required Option: `org`');
    }

    if (!this.options.token === null) {
      new Error('Missing Required Option: `token`');
    }

    this.Client = new Octokit({
      baseUrl: this.options.baseUrl,
      auth: this.options.token
    })
  }

  private _cache<T>(key: store.BlobKey, p: Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      this.options.cache.exists(key, (err, exists) => {
        if (err) reject(err);
        if (exists) {
          console.log('cache hit');
          const data: string[] = [];
          this.options.cache.createReadStream(key)
            .on('data', (chunk) => {
              data.push(chunk.toString());
            })
            .on('end', () => {
              return resolve(JSON.parse(data.join('')));
            });
        } else {
          console.log('cache miss');
          return resolve(p.then((data: any) => {
            const stream = this.options.cache.createWriteStream(key, console.error)
            stream.write(JSON.stringify(data), 'utf8')
            stream.end();
            return data;
          }));
        }
      });
    });
  }

  _clear(key: store.BlobKey) {
    this.options.cache.remove(key, console.error);
  }

  _format(data: Issue) {
    const tickets = data.map((ticket) => {
      return {
        id: ticket.id,
        org: this.options.org,
        repos: ticket.repository?.name,
        opened: ticket.created_at,
        reopened: null,
        assigned: null,
        closed: null,
        reaction_time: null,
        cycle_time: null,
        lead_time: null
      }
    });
    return tickets;
  }

  _process(ticket: { closed: any; reopened: any; assigned: any; _timeline: any; }, timeline: any[]) {
    timeline.forEach((tl: { event: any; created_at: any; }) => {
      switch (tl.event) {
        case 'closed':
          ticket.closed = tl.created_at;
          break;
        case 'reopened':
          ticket.reopened = tl.created_at;
          break;
        case 'assigned':
          ticket.assigned = tl.created_at;
          break;
        default:
          break;
      }
    });
    delete ticket._timeline;
    return ticket;
  }

  _duration(start: moment.MomentInput, end: moment.MomentInput) {
    start = new moment(start);
    end = new moment(end);

    if (start.isValid() && end.isValid()) {
      return moment.duration(end.diff(start)).as('seconds');
    } else {
      return 0;
    }
  }

  _times(ticket: { reaction_time: number; opened: any; assigned: any; cycle_time: number; closed: any; lead_time: number; }) {
    ticket.reaction_time = this._duration(ticket.opened, ticket.assigned);
    ticket.cycle_time = this._duration(ticket.assigned, ticket.closed);
    ticket.lead_time = this._duration(ticket.opened, ticket.closed);
    return ticket;
  }

  _aggregate(data: any[], type: string) {
    const agg = data.map((v: { [x: string]: any; }) => v[type]);
    return [math.mean(agg.slice(0)), math.median(agg.slice(0))];
  }

  _calculate(tickets: any[]) {
    return tickets.map((ticket: any) => {
      return this._times(ticket)
    });
  }

  _timeline(ticket: { org: any; id: any; repos: any; }) {
    const key = `github-cycle-time_timeline-${ticket.org}-${ticket.repos}-${ticket.id}.json`;
    return this._cache(key, this.Client.issues.listEventsForTimeline({
      issue_number: ticket.id, owner: ticket.org, repo: ticket.repos
    })
      .then((response) => {
        return this._process(ticket, response.data)
      }).catch((error: any) => error)
    );
  }

  _enhance(tickets: any[]) {
    return tickets.map((ticket: any) => {
      setTimeout(() => { }, 100);
      return this._timeline(ticket);
    });
  }

  _fetch(since: string) {
    return this._cache<Issue>('github-cycle-time_fetch.json',
      getIssues(this.Client, { org: this.options.org, filter: 'all', state: 'all', direction: 'asc', per_page: 100, page: 1, since })
    );
  }

  _humanize(duration_in_seconds: moment.DurationInputArg1) {
    return moment
      .duration(duration_in_seconds, 'seconds')
      .format({
        template: "w[W] d[D] h[H] m[M]",
        precision: 1
      });
  }

  async tickets(since: string) {
    const tickets = await this._fetch(since);
    const tickets_1 = this._format(tickets);
    const values = this._enhance(tickets_1);
    const tickets_3 = await Promise.all(values);
    return this._calculate(tickets_3);
  }

  async metrics(since: string) {
    const data = await this.tickets(since);
    const [rt_mean, rt_median] = this._aggregate(data, 'reaction_time');
    const [ct_mean, ct_median] = this._aggregate(data, 'cycle_time');
    const [lt_mean, lt_median] = this._aggregate(data, 'lead_time');

    return {
      org: this.options.org,
      reaction_time_mean: rt_mean,
      reaction_time_median: rt_median,
      reaction_time_mean_human: this._humanize(rt_mean),
      reaction_time_median_human: this._humanize(rt_median),
      cycle_time_mean: ct_mean,
      cycle_time_median: ct_median,
      cycle_time_mean_human: this._humanize(ct_mean),
      cycle_time_median_human: this._humanize(ct_median),
      lead_time_mean: lt_mean,
      lead_time_median: lt_median,
      lead_time_mean_human: this._humanize(lt_mean),
      lead_time_median_human: this._humanize(lt_median)
    };
  }
}
