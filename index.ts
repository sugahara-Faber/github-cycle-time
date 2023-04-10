import { mean, median } from "mathjs";
import * as moment from "moment";
import defaults from "defaults";
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
    owner: string;
    repo: string;
    state?: "all" | "open" | "closed";
    sort?: "created" | "updated" | "popularity" | "long-running";
    direction?: "asc" | "desc";
    per_page: number;
    page: number;
  }
) => {
  return (await client.pulls.list(opts)).data;
};

type Issue = Awaited<ReturnType<typeof getIssues>>;

type Options = {
  baseUrl: string;
  org: string;
  repo: string;
  token: string;
};

type Ticket = {
  id: number;
  org: string;
  opened: string;
  reopened?: string;
  assigned?: string;
  review_requested?: string;
  first_review?: string;
  approved?: string;
  closed?: string;

  reaction_time?: number;
  coding_time?: number;
  waiting_review?: number;
  reviewing_time?: number;
  waiting_release?: number;
  lead_time?: number;
};

type Timeline = Awaited<
  ReturnType<RestEndpointMethods["issues"]["listEventsForTimeline"]>
>["data"];

export class CycleTime {
  Client: Octokit;
  options: Options;

  constructor(options: Partial<Options> = {}) {
    this.options = defaults(options, {
      baseUrl: "https://api.github.com",
      org: null,
      repo: null,
      token: null,
    });

    if (this.options.org === null) {
      new Error("Missing Required Option: `org`");
    }

    if (this.options.repo === null) {
      new Error("Missing Required Option: `repo`");
    }

    if (!this.options.token === null) {
      new Error("Missing Required Option: `token`");
    }

    this.Client = new Octokit({
      baseUrl: this.options.baseUrl,
      auth: this.options.token,
    });
  }

  private _format(data: Issue): Ticket[] {
    const tickets = data.map((ticket) => {
      return {
        id: ticket.number,
        org: this.options.org,
        repos: ticket.head.repo.name,
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
          if (!ticket.assigned) ticket.assigned = tl.created_at;
          break;
        case "review_requested":
          if (!ticket.review_requested) ticket.review_requested = tl.created_at;
          break;
        case "reviewed":
          if (!ticket.first_review) ticket.first_review = tl.submitted_at;
          if (tl.state === "approved") ticket.approved = tl.submitted_at;
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
    ticket.coding_time = this._duration(ticket.opened, ticket.review_requested);
    ticket.waiting_review = this._duration(
      ticket.review_requested,
      ticket.first_review
    );
    ticket.reviewing_time = this._duration(
      ticket.first_review,
      ticket.approved
    );
    ticket.waiting_release = this._duration(ticket.approved, ticket.closed);
    ticket.lead_time = this._duration(ticket.opened, ticket.closed);
    return ticket;
  }

  private _aggregate(
    data: Ticket[],
    type:
      | "reaction_time"
      | "coding_time"
      | "waiting_review"
      | "reviewing_time"
      | "waiting_release"
      | "lead_time"
  ) {
    const agg = data.map((v) => v[type] ?? 0);
    return [mean(agg.slice(0)), median(agg.slice(0))];
  }

  private _calculate(tickets: Ticket[]) {
    return tickets.map((ticket) => {
      return this._times(ticket);
    });
  }

  private async _timeline(ticket: Ticket) {
    const data = await this.Client.paginate(
      this.Client.issues.listEventsForTimeline,
      {
        issue_number: ticket.id,
        owner: ticket.org,
        repo: this.options.repo,
      }
    );
    return this._process(ticket, data);
  }

  private async _enhance(tickets: Ticket[]) {
    const ticketsWithTime: Ticket[] = [];
    for (const ticket of tickets) {
      ticketsWithTime.push(await this._timeline(ticket));
      await setTimeout(100);
    }
    return ticketsWithTime;
  }

  private _fetch() {
    return getIssues(this.Client, {
      owner: this.options.org,
      repo: this.options.repo,
      state: "closed",
      per_page: 10,
      page: 1,
    });
  }

  private _humanize(duration_in_seconds: moment.DurationInputArg1) {
    return moment.duration(duration_in_seconds, "seconds").format({
      template: "w[W] d[D] h[H] m[M]",
      precision: 1,
    });
  }

  async tickets() {
    const pulls = await this._fetch();
    const tickets_1 = this._format(pulls);
    const tickets_3 = await this._enhance(tickets_1);
    return this._calculate(tickets_3);
  }

  async metrics() {
    const data = await this.tickets();
    const [rt_mean, rt_median] = this._aggregate(data, "reaction_time");
    const [ct_mean, ct_median] = this._aggregate(data, "coding_time");
    const [wr_mean, wr_median] = this._aggregate(data, "waiting_review");
    const [rv_mean, rv_median] = this._aggregate(data, "reviewing_time");
    const [wl_mean, wl_median] = this._aggregate(data, "waiting_release");
    const [lt_mean, lt_median] = this._aggregate(data, "lead_time");

    return {
      n: data.length,
      reaction_time_mean: rt_mean,
      reaction_time_median: rt_median,
      coding_time_mean: ct_mean,
      coding_time_median: ct_median,
      waiting_review_mean: wr_mean,
      waiting_review_median: wr_median,
      reviewing_time_mean: rv_mean,
      reviewing_time_median: rv_median,
      waiting_release_mean: wl_mean,
      waiting_release_median: wl_median,
      lead_time_mean: lt_mean,
      lead_time_median: lt_median,
    };
  }
}
