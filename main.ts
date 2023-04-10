import { config } from "dotenv";
import { CycleTime } from ".";
import cache from "fs-blob-store";

config();

const ct = new CycleTime({
  cache: new cache({ path: "cache/" }),
  org: process.env.GITHUB_ORG,
  token: process.env.GITHUB_TOKEN,
});

(async () => {
  console.log(await ct.tickets("2023-04-01T09:00:00Z"));
})();
