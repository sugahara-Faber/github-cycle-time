import { max, mean, median } from "mathjs";
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

type Duration = {
  seconds: number;
  human: string;
};

type Ticket = {
  id: number;
  opened: string;
  reopened?: string;
  assigned?: string;
  review_requested?: string;
  first_review?: string;
  approved?: string;
  closed?: string;

  reaction_time?: Duration;
  waiting_review?: Duration;
  reviewing_time?: Duration;
  waiting_release?: Duration;
  lead_time?: Duration;
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

  private format(data: Issue): Ticket[] {
    const tickets = data.map((ticket) => {
      return {
        id: ticket.number,
        title: ticket.title,
        opened: ticket.created_at,
      };
    });
    return tickets;
  }

  private process(ticket: Ticket, timeline: Timeline) {
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

  private humanize(diff: moment.DurationInputArg1) {
    const duration = moment.duration(diff);
    return {
      seconds: duration.as("second"),
      human: duration.format("DD[d] hh[h] mm[m]"),
    };
  }

  private duration(
    start: moment.MomentInput,
    end: moment.MomentInput
  ): Duration {
    const startTime = moment.default(start);
    const endTime = moment.default(end);

    if (startTime.isValid() && endTime.isValid()) {
      return this.humanize(endTime.diff(startTime));
    } else {
      return this.humanize(0);
    }
  }

  private times(ticket: Ticket) {
    ticket.reaction_time = this.duration(ticket.opened, ticket.assigned);
    ticket.waiting_review = this.duration(
      ticket.review_requested,
      ticket.first_review
    );
    ticket.reviewing_time = this.duration(ticket.first_review, ticket.approved);
    ticket.waiting_release = this.duration(ticket.approved, ticket.closed);
    ticket.lead_time = this.duration(ticket.opened, ticket.closed);
    return ticket;
  }

  private aggregate(
    data: Ticket[],
    type:
      | "reaction_time"
      | "waiting_review"
      | "reviewing_time"
      | "waiting_release"
      | "lead_time"
  ) {
    const agg = data.map((v) => v[type]?.seconds ?? 0);
    return {
      mean: this.humanize(mean(agg.slice(0)) * 1000),
      median: this.humanize(median(agg.slice(0)) * 1000),
      max: this.humanize(max(agg.slice(0)) * 1000),
    };
  }

  private _calculate(tickets: Ticket[]) {
    return tickets.map((ticket) => {
      return this.times(ticket);
    });
  }

  private async _timeline(ticket: Ticket) {
    const data = await this.Client.paginate(
      this.Client.issues.listEventsForTimeline,
      {
        issue_number: ticket.id,
        owner: this.options.org,
        repo: this.options.repo,
      }
    );
    return this.process(ticket, data);
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
      sort: "updated",
      direction: "desc",
      per_page: 100,
      page: 1,
    });
  }

  async tickets() {
    const pulls = await this._fetch();
    const tickets_1 = this.format(
      pulls.filter((p) => !p.title.startsWith("Release"))
    );
    const tickets_3 = await this._enhance(tickets_1);
    return this._calculate(
      tickets_3.filter(
        (p) =>
          p.approved && moment.default(p.closed).diff(moment.now()) > -674800000
      )
    );
  }

  metrics(tickets: Ticket[]) {
    return {
      n: tickets.length,
      reaction_time: this.aggregate(tickets, "reaction_time"),
      waiting_review: this.aggregate(tickets, "waiting_review"),
      reviewing_time: this.aggregate(tickets, "reviewing_time"),
      waiting_release: this.aggregate(tickets, "waiting_release"),
      lead_time: this.aggregate(tickets, "lead_time"),
    };
  }
}
