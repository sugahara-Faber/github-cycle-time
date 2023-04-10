import math from "mathjs";
import * as moment from "moment";
import defaults from "defaults";
import store from "abstract-blob-store";
import momentDurationSetup from "moment-duration-format";
import { Octokit } from "@octokit/rest";
import { PaginateInterface } from "@octokit/plugin-paginate-rest";
import { RestEndpointMethods } from "@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types";
import { Api } from "@octokit/plugin-rest-endpoint-methods/dist-types/types";
import { setTimeout } from "timers/promises";

momentDurationSetup(moment);

const getIssues = async (
  client: Octokit & { paginate: PaginateInterface } & RestEndpointMethods & Api,
  opts: {
    org: string;
    filter?:
      | "all"
      | "assigned"
      | "created"
      | "mentioned"
      | "subscribed"
      | "repos";
    state?: "all" | "open" | "closed";
    direction?: "asc" | "desc";
    per_page: number;
    page: number;
    since: string;
  }
) => {
  return await client.paginate(client.issues.list, opts);
};

type Issue = Awaited<ReturnType<typeof getIssues>>;

type Options = {
  baseUrl: string;
  cache: store;
  org: string;
  token: string;
};

type Ticket = {
  id: number;
  org: string;
  repos: string;
  opened: string;
  reopened?: string;
  assigned?: string;
  closed?: string;
  reaction_time?: number;
  cycle_time?: number;
  lead_time?: number;
};

type Timeline = Awaited<
  ReturnType<RestEndpointMethods["issues"]["listEventsForTimeline"]>
>["data"];

export class CycleTime {
  Client: Octokit;
  options: Options;

  constructor(options = {}) {
    this.options = defaults(options, {
      baseUrl: "https://api.github.com",
      cache: new store(),
      org: null,
      token: null,
    });

    if (this.options.org === null) {
      new Error("Missing Required Option: `org`");
    }

    if (!this.options.token === null) {
      new Error("Missing Required Option: `token`");
    }

    this.Client = new Octokit({
      baseUrl: this.options.baseUrl,
      auth: this.options.token,
    });
  }

  private _cache<T>(key: store.BlobKey, p: Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      this.options.cache.exists(key, (err, exists) => {
        if (err) reject(err);
        if (exists) {
          console.log("cache hit");
          const data: string[] = [];
          this.options.cache
            .createReadStream(key)
            .on("data", (chunk) => {
              data.push(chunk.toString());
            })
            .on("end", () => {
              return resolve(JSON.parse(data.join("")));
            });
        } else {
          console.log("cache miss");
          return resolve(
            p.then((data) => {
              const stream = this.options.cache.createWriteStream(
                key,
                console.error
              );
              stream.write(JSON.stringify(data), "utf8");
              stream.end();
              return data;
            })
          );
        }
      });
    });
  }

  private _format(data: Issue): Ticket[] {
    const tickets = data.map((ticket) => {
      return {
        id: ticket.id,
        org: this.options.org,
        repos: ticket.repository?.name ?? "",
        opened: ticket.created_at,
      };
    });
    return tickets;
  }

  private _process(ticket: Ticket, timeline: Timeline) {
    timeline.forEach((tl) => {
      switch (tl.event) {
        case "closed":
          ticket.closed = tl.created_at;
          break;
        case "reopened":
          ticket.reopened = tl.created_at;
          break;
        case "assigned":
          ticket.assigned = tl.created_at;
          break;
        default:
          break;
      }
    });
    return ticket;
  }

  private _duration(start: moment.MomentInput, end: moment.MomentInput) {
    const startTime = moment.default(start);
    const endTime = moment.default(end);

    if (startTime.isValid() && endTime.isValid()) {
      return moment.duration(endTime.diff(startTime)).as("seconds");
    } else {
      return 0;
    }
  }

  private _times(ticket: Ticket) {
    ticket.reaction_time = this._duration(ticket.opened, ticket.assigned);
    ticket.cycle_time = this._duration(ticket.assigned, ticket.closed);
    ticket.lead_time = this._duration(ticket.opened, ticket.closed);
    return ticket;
  }

  private _aggregate(
    data: Ticket[],
    type: "reaction_time" | "cycle_time" | "lead_time"
  ) {
    const agg = data.map((v) => v[type] ?? 0);
    return [math.mean(agg.slice(0)), math.median(agg.slice(0))];
  }

  private _calculate(tickets: Ticket[]) {
    return tickets.map((ticket) => {
      return this._times(ticket);
    });
  }

  private _timeline(ticket: Ticket) {
    const key = `github-cycle-time_timeline-${ticket.org}-${ticket.repos}-${ticket.id}.json`;
    return this._cache<Ticket>(
      key,
      this.Client.issues
        .listEventsForTimeline({
          issue_number: ticket.id,
          owner: ticket.org,
          repo: ticket.repos,
        })
        .then((response) => {
          return this._process(ticket, response.data);
        })
    );
  }

  private async _enhance(tickets: Ticket[]) {
    const ticketsWithTime: Ticket[] = [];
    for (const ticket of tickets) {
      ticketsWithTime.push(await this._timeline(ticket));
      await setTimeout(100);
    }
    return ticketsWithTime;
  }

  private _fetch(since: string) {
    return this._cache<Issue>(
      "github-cycle-time_fetch.json",
      getIssues(this.Client, {
        org: this.options.org,
        filter: "all",
        state: "all",
        direction: "asc",
        per_page: 100,
        page: 1,
        since,
      })
    );
  }

  private _humanize(duration_in_seconds: moment.DurationInputArg1) {
    return moment.duration(duration_in_seconds, "seconds").format({
      template: "w[W] d[D] h[H] m[M]",
      precision: 1,
    });
  }

  async tickets(since: string) {
    const tickets = await this._fetch(since);
    const tickets_1 = this._format(tickets);
    const tickets_3 = await this._enhance(tickets_1);
    return this._calculate(tickets_3);
  }

  async metrics(since: string) {
    const data = await this.tickets(since);
    const [rt_mean, rt_median] = this._aggregate(data, "reaction_time");
    const [ct_mean, ct_median] = this._aggregate(data, "cycle_time");
    const [lt_mean, lt_median] = this._aggregate(data, "lead_time");

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
      lead_time_median_human: this._humanize(lt_median),
    };
  }
}
