import { config } from "dotenv";
import { CycleTime } from ".";
import { table } from "table";
import moment from "moment";

config();

const ct = new CycleTime({
  org: process.env.GITHUB_ORG,
  repo: process.env.GITHUB_REPO,
  token: process.env.GITHUB_TOKEN,
});

(async () => {
  const tickets = await ct.tickets();
  const metrics = ct.metrics(tickets);

  const data: (string | number)[][] = [
    [`N = ${metrics.n}`, "mean", "median", "max"],
  ];
  for (const [k, v] of Object.entries(metrics)) {
    if (typeof v === "number") continue;
    data.push([
      k.replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase()),
      v.mean.human,
      v.median.human,
      v.max.human,
    ]);
  }

  const today = moment().format("YYYY-MM-DD");

  const text =
    "```\n" +
    table(data, {
      header: { content: today },
      drawHorizontalLine: (i, r) => i <= 2 || i === r,
      columns: {
        1: { alignment: "right" },
        2: { alignment: "right" },
        3: { alignment: "right" },
      },
    }) +
    "```";

  console.log(JSON.stringify({ text }));
})();
