import { config } from "dotenv";
import { CycleTime } from ".";

config();

const ct = new CycleTime({
  org: process.env.GITHUB_ORG,
  repo: process.env.GITHUB_REPO,
  token: process.env.GITHUB_TOKEN,
});

(async () => {
  const tickets = await ct.tickets();
  console.log(ct.metrics(tickets));
})();
